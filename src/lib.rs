#![cfg_attr(not(feature = "std"), no_std, no_main)]

#[ink::contract]
mod escrow {
    use ink::primitives::U256;
    use ink::primitives::H160;

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[ink::scale_derive(Encode, Decode, TypeInfo)]
    pub enum EscrowState {
        PendingWork,
        AwaitingApproval,
        Disputed,
        Completed,
        Refunded,
    }

    impl EscrowState {
        fn from_u8(value: u8) -> Self {
            match value {
                0 => EscrowState::PendingWork,
                1 => EscrowState::AwaitingApproval,
                2 => EscrowState::Disputed,
                3 => EscrowState::Completed,
                _ => EscrowState::Refunded,
            }
        }
        fn to_u8(self) -> u8 {
            self as u8
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[ink::scale_derive(Encode, Decode, TypeInfo)]
    pub enum Error {
        Unauthorized,
        AddressMismatch { caller: H160, expected: H160 },
        InvalidState,
        DeadlineNotPassed,
        DeadlinePassed,
        TransferFailed,
        ZeroDeposit,
    }

    #[ink(storage)]
    pub struct Escrow {
        client: Address,
        provider: Address,
        arbitrator: Address,
        amount: U256,
        duration: u64,
        expiry: u64,
        state: u8,
    }

    impl Escrow {
        #[ink(constructor, payable)]
        pub fn new(provider: Address, arbitrator: Address, duration: u64) -> Self {
            let caller = Self::env().caller();
            let amount = Self::env().transferred_value();

            Self {
                client: caller,
                provider,
                arbitrator,
                amount,
                duration,
                expiry: 0,
                state: EscrowState::PendingWork.to_u8(),
            }
        }

        /// Confirms the off-chain work event and starts the escrow deadline.
        /// The arbitrator is expected to be the account used by the GitHub webhook service.
        #[ink(message)]
        pub fn complete_work(&mut self) -> Result<(), Error> {
            if self.env().caller() != self.arbitrator {
                return Err(Error::AddressMismatch {
                    caller: self.env().caller(),
                    expected: self.arbitrator,
                });
            }
            if EscrowState::from_u8(self.state) != EscrowState::PendingWork {
                return Err(Error::InvalidState);
            }

            self.expiry = self.env().block_timestamp() + (self.duration * 1000);
            self.state = EscrowState::AwaitingApproval.to_u8();
            Ok(())
        }

        /// RELEASE PAYMENT
        /// Called by the Client to pay the Provider, or by the Arbitrator to settle a dispute in favor of the Provider.
        #[ink(message)]
        pub fn release_payment(&mut self) -> Result<(), Error> {
            let caller = self.env().caller();

            match EscrowState::from_u8(self.state) {
                EscrowState::AwaitingApproval => {
                    // Under normal circumstances, only the client can release the funds
                    if caller != self.client {
                        return Err(Error::Unauthorized);
                    }
                    // Prevent closing if the contract expired before they approved (forces cleanup/refund instead)
                    if self.env().block_timestamp() >= self.expiry {
                        return Err(Error::DeadlinePassed);
                    }
                }
                EscrowState::Disputed => {
                    // If a dispute is active, only the arbitrator can make the call
                    if caller != self.arbitrator {
                        return Err(Error::Unauthorized);
                    }
                }
                _ => return Err(Error::InvalidState),
            }

            self.state = EscrowState::Completed.to_u8();

            // Transfer the contract's held balance to the artist
            self.env()
                .transfer(self.provider, self.amount)
                .map_err(|_| Error::TransferFailed)?;

            Ok(())
        }

        /// 2. REFUND CLIENT
        /// Called by the Client after the deadline, or by the Arbitrator to settle a dispute in favor of the Client.
        #[ink(message)]
        pub fn refund_client(&mut self) -> Result<(), Error> {
            let caller = self.env().caller();

            match EscrowState::from_u8(self.state) {
                EscrowState::AwaitingApproval => {
                    if caller != self.client {
                        return Err(Error::Unauthorized);
                    }
                    // The customer cannot pull out funds early unless there's an active dispute
                    if self.env().block_timestamp() < self.expiry {
                        return Err(Error::DeadlineNotPassed);
                    }
                }
                EscrowState::Disputed => {
                    if caller != self.arbitrator {
                        return Err(Error::Unauthorized);
                    }
                }
                _ => return Err(Error::InvalidState),
            }

            self.state = EscrowState::Refunded.to_u8();

            // Return the locked funds back to the customer
            self.env()
                .transfer(self.client, self.amount)
                .map_err(|_| Error::TransferFailed)?;

            Ok(())
        }

        /// 3. TRIGGER DISPUTE
        /// Can be triggered by either the client or the provider if negotiations break down.
        /// This freezes normal operations and passes absolute judgment control to the arbitrator.
        #[ink(message)]
        pub fn raise_dispute(&mut self) -> Result<(), Error> {
            let caller = self.env().caller();
            
            if caller != self.client && caller != self.provider  {
                return Err(Error::Unauthorized);
            }
            if EscrowState::from_u8(self.state) != EscrowState::AwaitingApproval {
                return Err(Error::InvalidState);
            }

            self.state = EscrowState::Disputed.to_u8();
            Ok(())
        }

        #[ink(message)]
        pub fn get_state(&self) -> EscrowState {
            EscrowState::from_u8(self.state)
        }

        #[ink(message)]
        pub fn get_arbitrator(&self) -> Address {
            self.arbitrator
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn create_address(id: u8) -> Address {
            let mut bytes = [0u8; 20];
            bytes[0] = id;
            Address::from(bytes)
        }

        fn set_sender(sender: Address) {
            ink::env::test::set_caller(sender);
        }

        fn set_block_timestamp(timestamp: u64) {
            ink::env::test::set_block_timestamp::<ink::env::DefaultEnvironment>(timestamp);
        }

        #[ink::test]
        fn standard_flow_works() {
            let client = create_address(1);
            let provider = create_address(2);
            let arbitrator = create_address(3);

            set_sender(client);
            ink::env::test::set_value_transferred(U256::from(100));
            set_block_timestamp(0);
            let mut contract = Escrow::new(provider, arbitrator, 10);
            assert_eq!(contract.get_state(), EscrowState::PendingWork);

            set_sender(arbitrator);
            assert_eq!(contract.complete_work(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::AwaitingApproval);

            set_sender(client);
            assert_eq!(contract.release_payment(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::Completed);
        }

        #[ink::test]
        fn refund_after_deadline_works() {
            let client = create_address(1);
            let provider = create_address(2);
            let arbitrator = create_address(3);

            set_sender(client);
            ink::env::test::set_value_transferred(U256::from(100));
            set_block_timestamp(0);
            let mut contract = Escrow::new(provider, arbitrator, 10);

            set_sender(arbitrator);
            assert_eq!(contract.complete_work(), Ok(()));

            set_sender(client);
            set_block_timestamp(5000);
            assert_eq!(contract.refund_client(), Err(Error::DeadlineNotPassed));

            set_block_timestamp(15000);
            assert_eq!(contract.refund_client(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::Refunded);
        }

        #[ink::test]
        fn dispute_resolution_works() {
            let client = create_address(1);
            let provider = create_address(2);
            let arbitrator = create_address(3);

            set_sender(client);
            ink::env::test::set_value_transferred(U256::from(100));
            set_block_timestamp(0);
            let mut contract = Escrow::new(provider, arbitrator, 10);

            set_sender(arbitrator);
            assert_eq!(contract.complete_work(), Ok(()));

            set_sender(provider);
            assert_eq!(contract.raise_dispute(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::Disputed);

            set_sender(arbitrator);
            assert_eq!(contract.release_payment(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::Completed);
        }

        #[ink::test]
        fn only_arbitrator_can_complete_pending_work() {
            let client = create_address(1);
            let provider = create_address(2);
            let arbitrator = create_address(3);

            set_sender(client);
            ink::env::test::set_value_transferred(U256::from(100));
            set_block_timestamp(1_000);
            let mut contract = Escrow::new(provider, arbitrator, 10);

            assert_eq!(contract.complete_work(), Err(Error::Unauthorized));

            set_sender(arbitrator);
            assert_eq!(contract.complete_work(), Ok(()));
            assert_eq!(contract.get_state(), EscrowState::AwaitingApproval);
        }
    }
}

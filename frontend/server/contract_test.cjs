const c = require("./contract.cjs");

const test = async () => {
    try {
        await c.init();
        const state = await c.getState();
        console.log(state);
    } finally {
        await c.disconnect();
    }
};

test();

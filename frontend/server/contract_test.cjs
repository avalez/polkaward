const c = require("./contract.cjs");

const test = async () => {
    try {
        await c.init();
        const hash = await c.increment();
        console.log(hash);
    } finally {
        await c.disconnect();
    }
};

test();

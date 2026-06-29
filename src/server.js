require("dotenv").config();

const express = require("express");

const contract = require("./contract");
const github = require("./github");

const app = express();

app.use(express.json({
    verify(req, res, buf) {
        req.rawBody = buf;
    }
}));

contract.init();

app.post("/github", async (req, res) => {

    if (!github.verify(req)) {
        return res.sendStatus(401);
    }

    const event = req.headers["x-github-event"];

    if (event !== "push") {
        return res.sendStatus(200);
    }

    try {

        const hash = await contract.increment();

        console.log("Contract updated:", hash);

        res.json({
            success: true,
            tx: hash
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.toString()
        });

    }

});

app.listen(process.env.PORT, () => {
    console.log(`Listening on ${process.env.PORT}`);
});
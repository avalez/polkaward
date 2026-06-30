const path = require("path");

const express = require("express");

const contract = require("./contract.cjs");
const github = require("./github.cjs");

const app = express();
const distDir = path.resolve(__dirname, "../dist");
const port = process.env.PORT || 3000;

app.post("/", express.raw({
    type: "*/*"
}), async (req, res) => {
    const webhookResponse = await github.handleGithubWebhook(req);

    if (webhookResponse.statusCode !== 202) {
        return res
            .status(webhookResponse.statusCode)
            .type(webhookResponse.contentType)
            .send(webhookResponse.body);
    }

    const event = req.headers["x-github-event"];

    if (event !== "push") {
        return res
            .status(webhookResponse.statusCode)
            .type(webhookResponse.contentType)
            .send(webhookResponse.body);
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

app.use(express.static(distDir));

app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
});

async function start() {
    await contract.init();

    app.listen(port, () => {
        console.log(`Listening on ${port}`);
    });
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});

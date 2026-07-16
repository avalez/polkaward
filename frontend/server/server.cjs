const path = require("path");

const express = require("express");

const contract = require("./contract.cjs");
const github = require("./github.cjs");
const { createGitHubFlowStore } = require("./github-flow.cjs");

const app = express();
const distDir = path.resolve(__dirname, "../dist");
const port = process.env.PORT || 3000;
const githubFlowStore = createGitHubFlowStore();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "http://localhost:5173");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    return next();
});

app.use(express.json());

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
    const repo = req.body?.repository?.full_name || req.body?.repository?.name;

    if (event !== "push") {
        return res
            .status(webhookResponse.statusCode)
            .type(webhookResponse.contentType)
            .send(webhookResponse.body);
    }

    if (repo) {
        githubFlowStore.setPendingApproval(repo, {
            action: "release_payment",
            status: "pending"
        });
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

app.post("/github/approval", (req, res) => {
    try {
        const { repo, walletAddress, installationId } = req.body || {};

        if (!repo || !walletAddress) {
            return res.status(400).json({ success: false, error: "repo and walletAddress are required" });
        }

        githubFlowStore.setRepoWalletMapping(repo, walletAddress, installationId || null);
        githubFlowStore.setPendingApproval(repo, {
            action: "release_payment",
            status: "pending"
        });

        return res.json({ success: true, repo, walletAddress });
    } catch (error) {
        console.error("GitHub approval error", error);
        return res.status(500).json({ success: false, error: error instanceof Error ? error.message : "GitHub approval failed" });
    }
});

app.get("/github/approvals", (req, res) => {
    res.json(githubFlowStore.getPendingApprovals());
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

const path = require("path");

const express = require("express");

const contract = require("./contract.cjs");
const github = require("./github.cjs");
const { createGitHubFlowStore } = require("./github-flow.cjs");

const app = express();
const distDir = path.resolve(__dirname, "../dist");
const port = process.env.PORT || 3000;
const githubFlowStore = createGitHubFlowStore();

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
    const { repo, walletAddress, installationId } = req.body || {};

    if (!repo || !walletAddress) {
        return res.status(400).json({ error: "repo and walletAddress are required" });
    }

    githubFlowStore.setRepoWalletMapping(repo, walletAddress, installationId || null);
    githubFlowStore.setPendingApproval(repo, {
        action: "release_payment",
        status: "pending"
    });

    res.json({ success: true, repo, walletAddress });
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

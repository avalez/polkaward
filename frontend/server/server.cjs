const path = require("path");

// Support launching this file directly (`node frontend/server/server.cjs`).
// Existing environment variables retain precedence over values from the file.
if (typeof process.loadEnvFile === "function") {
    try {
        process.loadEnvFile(path.resolve(__dirname, "../../.env"));
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
}

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

const webhookBodyParser = express.raw({ type: "*/*" });

async function handleWebhook(req, res) {
    const webhookResponse = await github.handleGithubWebhook(req);

    if (webhookResponse.statusCode !== 202) {
        return res
            .status(webhookResponse.statusCode)
            .type(webhookResponse.contentType)
            .send(webhookResponse.body);
    }

    const event = req.headers["x-github-event"];
    const repo = webhookResponse.payload?.repository?.full_name ||
        webhookResponse.payload?.repository?.name;

    if (event !== "push") {
        return res
            .status(webhookResponse.statusCode)
            .type(webhookResponse.contentType)
            .send(webhookResponse.body);
    }

    if (!repo) {
        return res.status(400).json({ error: "GitHub webhook payload has no repository name" });
    }

    githubFlowStore.setPendingApproval(repo, {
        action: "complete_work",
        status: "pending"
    });

    try {
        const mapping = githubFlowStore.getRepoWalletMapping(repo);

        if (!mapping?.contractAddress) {
            return res.status(409).json({
                error: `No escrow contract is linked to ${repo}. Create an escrow or reconnect GitHub approval.`
            });
        }

        contract.setContractAddress(mapping.contractAddress);
        const hash = await contract.completeWork();

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
}

// Prefer the explicit path in GitHub settings. Keep POST / for compatibility
// with installations that already point at the server root.
app.post("/github/webhook", webhookBodyParser, handleWebhook);
app.post("/", webhookBodyParser, handleWebhook);

// JSON parsing must come after webhook routes so signature verification sees
// GitHub's exact request bytes.
app.use(express.json());

app.post("/github/approval", (req, res) => {
    try {
        const { repo, walletAddress, installationId, contractAddress } = req.body || {};

        if (!repo || !walletAddress) {
            return res.status(400).json({ success: false, error: "repo and walletAddress are required" });
        }

        githubFlowStore.setRepoWalletMapping(
            repo,
            walletAddress,
            installationId || null,
            contractAddress || null
        );
        githubFlowStore.setPendingApproval(repo, {
            action: "complete_work",
            status: "pending"
        });

        return res.json({ success: true, repo, walletAddress, contractAddress: contractAddress || null });
    } catch (error) {
        console.error("GitHub approval error", error);
        return res.status(500).json({ success: false, error: error instanceof Error ? error.message : "GitHub approval failed" });
    }
});

app.get("/github/approvals", (req, res) => {
    res.json(githubFlowStore.getPendingApprovals());
});

app.get("/contract/signer-address", async (_req, res) => {
    try {
        res.json({ address: await contract.getSignerAddress() });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
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

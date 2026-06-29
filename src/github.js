const crypto = require("crypto");

function verify(req) {

    const signature = req.headers["x-hub-signature-256"];

    const hmac =
        "sha256=" +
        crypto
            .createHmac(
                "sha256",
                process.env.GITHUB_SECRET
            )
            .update(req.rawBody)
            .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(hmac)
    );
}

module.exports = {
    verify
};
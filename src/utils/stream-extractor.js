const { exec } = require("child_process");

function extractStream(url) {
    return new Promise((resolve, reject) => {

        const command = `yt-dlp -g "${url}"`;

        exec(command, (error, stdout) => {
            if (error) return reject(error);

            const streams = stdout
                .split("\n")
                .filter(Boolean);

            resolve(streams);
        });
    });
}

module.exports = { extractStream };
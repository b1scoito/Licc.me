const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");
const querystring = require("querystring");
const channel = require("class/channel.js");
const cookie = require("class/cookie.js");
const log = require("class/log.js");

const mime = {
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".m4a": "audio/mp4"
};

const path = {
    get: {
        messages: ["channels", "guilds"]
    },
    post: {
        change: ["password", "username"],
        invites: ["delete", "new", "get"]
    }
};

const channels = {
    dm: new Map(),
    pending: new Map(),
    guild: new Map()
};
channels.dm.set(channel.EVERYONE, new Set());
const users = new Map();

const wss = new WebSocket.Server({ host: "127.0.0.1", port: 3333 });

http.createServer(async (req, res) => {
    const url = require("url").parse(req.url);

    if (req.method === "GET") {
        if (url.pathname === "/") {
            const session = new (require("class/session.js"))(cookie.parse(req.headers.cookie, "token"));
            res.writeHead(200, {
                "Content-Type": "text/html"
            });

            if (await session.set()) {
                fs.createReadStream("index.html", "utf8").pipe(res);
            } else {
                fs.createReadStream("login.html", "utf8").pipe(res);
            }
        } else {
            const split = url.pathname.substr(1).split("/");

            if (path.get.hasOwnProperty(split[0]) && path.get[split[0]].includes(split[1])) {
                const session = new (require("class/session.js"))(cookie.parse(req.headers.cookie, "token"));

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });
                res.end(JSON.stringify(await require(`${split[0]}/${split[1]}.js`)(session, querystring.parse(url.query))));
            } else if (url.pathname === "/logout") {
                const token = cookie.parse(req.headers.cookie, "token");

                if (token !== null) {
                    const session = new (require("class/session.js"))(token);
                    await session.set();
                    await session.destroy();

                    res.writeHead(200, {
                        "Content-Type": "application/json",
                        "Set-Cookie": `token=; Max-Age=-1; Path=/; HttpOnly`
                    });
                    res.end(JSON.stringify({
                        status: true
                    }));
                } else {
                    res.writeHead(404, {
                        "Content-Type": "text/html"
                    });
                    fs.createReadStream("404.html", "utf8").pipe(res);
                }
            } else {
                const extension = url.pathname.substr(url.pathname.lastIndexOf("."));

                if (mime.hasOwnProperty(extension) || split[0] === "emojis") {
                    fs.readFile(`.${url.pathname}`, (error, data) => {
                        if (error) {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                            return;
                        }

                        res.writeHead(200, {
                            "Content-Type": mime[extension] || "application/octet-stream",
                            "Cache-Control": "max-age=604800"
                        });
                        res.end(data);
                    });
                } else {
                    res.writeHead(404, {
                        "Content-Type": "text/html"
                    });
                    fs.createReadStream("404.html", "utf8").pipe(res);
                }
            }
        }
    } else if (req.method === "POST") {
        let message = "";
        req.setEncoding("utf8");
        req.on("data", chunk => {
            message += chunk;
        });

        req.on("end", async () => {
            try {
                if (message !== "") {
                    message = JSON.parse(message);
                }

                const split = url.pathname.substr(1).split("/");
                const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
                const session = new (require("class/session.js"))(cookie.parse(req.headers.cookie, "token"));

                switch (split[0]) {
                    case "auth":
                    {
                        if (split[1] === "login") {
                            if (await log.read(ip, "login")) {
                                let response = await require("auth/login.js")(session, message);

                                if (!response.status) {
                                    log.write(ip, "login");
                                }
                                if (response.token) {
                                    res.setHeader("Set-Cookie", `token=${response.token}; Max-Age=604800; Path=/; HttpOnly`);
                                    delete response.token;
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: false,
                                    error: "Too many attempts! Try again later"
                                }));
                            }
                        } else if (split[1] === "signup") {
                            if (await log.read(ip, "signup")) {
                                let response = await require("auth/signup.js")(session, message);

                                if (response.status) {
                                    log.write(ip, "signup");
                                }
                                if (response.token) {
                                    res.setHeader("Set-Cookie", `token=${response.token}; Max-Age=604800; Path=/; HttpOnly`);
                                    delete response.token;
                                }
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: false,
                                    error: "Account limit reached! Try again later"
                                }));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "application/json"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "change":
                    {
                        if (path.post.change.includes(split[1])) {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require(`change/${split[1]}.js`)(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "delete":
                    {
                        if (split[1] === "guild") {
                            let response = await require("delete/guild.js")(session, querystring.parse(url.query));

                            if (response.status) {
                                const set = channels.guild.get(response.channels[0]);

                                for (let channel_id of response.channels) {
                                    channels.guild.delete(channel_id);
                                }
                                delete response.channels;

                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "channel") {
                            let response = await require("delete/channel.js")(session, querystring.parse(url.query));

                            if (response.status) {
                                const set = channels.guild.get(response.channel_id);
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.guild.delete(response.channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }                            
                        } else if (split[1] === "emoji") {
                            let response = await require("delete/emoji.js")(session, querystring.parse(url.query));

                            if (response.access) {
                                const set = channels.guild.get(response.access);
                                delete response.access;
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }

                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(response);
                                } else {
                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(JSON.stringify(response));
                                }
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "invites":
                    {
                        if (split[1] === "join") {
                            let response = await require("invites/join.js")(session, message);

                            if (response.status) {
                                const set = users.get(session.user_id);
                                if (set) {
                                    const guild_channels = response.guild.channels;

                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            for (let guild_channel of guild_channels) {
                                                if (!channels.guild.has(guild_channel.id)) {
                                                    channels.guild.set(guild_channel.id, new Set());
                                                }
                                                channels.guild.get(guild_channel.id).add(client);
                                            }
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (path.post.invites.includes(split[1])) {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require(`invites/${split[1]}.js`)(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "leave":
                    {
                        if (split[1] === "guild") {
                            let response = await require("leave/guild.js")(session, querystring.parse(url.query));

                            if (response.status) {
                                const set = users.get(session.user_id);
                                if (set) {
                                    const channel_ids = response.channels;
                                    delete response.channels;

                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        for (let channel_id of channel_ids) {
                                            channels.guild.get(channel_id).delete(client);
                                        }
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "new":
                    {
                        if (split[1] === "guild") {
                            let response = await require("new/guild.js")(session, message);

                            if (response.status) {
                                channels.guild.set(response.guild.channels[0].id, new Set());

                                const set = users.get(session.user_id);
                                if (set) {
                                    const newChannel = channels.guild.get(response.guild.channels[0].id);

                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            newChannel.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "channel") {
                            let response = await require("new/channel.js")(session, querystring.parse(url.query), message);

                            if (response.status) {
                                channels.guild.set(response.channel.id, new Set());

                                const newChannel = channels.guild.get(response.channel.id);
                                const set = channels.guild.get(response.access);
                                delete response.access;
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            newChannel.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "emoji") {
                            let response = await require("new/emoji.js")(session, querystring.parse(url.query), message);

                            if (response.status) {
                                if (response.access) {
                                    const set = channels.guild.get(response.access);
                                    delete response.access;
                                    if (set) {
                                        response = JSON.stringify(response);
                                        for (let client of set) {
                                            if (client.readyState === WebSocket.OPEN) {
                                                client.send(response);
                                            } else {
                                                set.delete(client);
                                            }
                                        }

                                        res.writeHead(200, {
                                            "Content-Type": "application/json"
                                        });
                                        res.end(response);
                                    } else {
                                        res.writeHead(200, {
                                            "Content-Type": "application/json"
                                        });
                                        res.end(JSON.stringify(response));
                                    }
                                } else {
                                    res.writeHead(200, {
                                        "Content-Type": "application/json"
                                    });
                                    res.end(JSON.stringify(response));
                                }
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "update":
                    {
                        if (split[1] === "guild") {
                            let response = await require("update/guild.js")(session, querystring.parse(url.query), message);

                            if (response.status) {
                                const set = channels.guild.get(response.access);
                                delete response.access;
                                const icon = response.guild.icon;
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true,
                                    icon: icon
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "emoji") {
                            let response = await require("update/emoji.js")(session, querystring.parse(url.query), message);

                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(response));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "upload":
                    {
                        if (split[1] === "avatar") {
                            res.writeHead(200, {
                                "Content-Type": "application/json"
                            });
                            res.end(JSON.stringify(await require("upload/avatar.js")(session, message)));
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    case "users":
                    {
                        if (split[1] === "accept") {
                            let response = await require("users/accept.js")(session, querystring.parse(url.query));

                            if (response.status) {
                                const { channel_id } = response;
                                channels.dm.set(channel_id, new Set());

                                const newChannel = channels.dm.get(channel_id);
                                const set = channels.pending.get(channel_id);
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            newChannel.add(client);
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.pending.delete(channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "cancel") {
                            let response = await require("users/cancel.js")(session, querystring.parse(url.query));

                            if (response.status) {
                                const { channel_id } = response;

                                const set = channels.pending.get(channel_id);
                                if (set) {
                                    response = JSON.stringify(response);
                                    for (let client of set) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(response);
                                        } else {
                                            set.delete(client);
                                        }
                                    }
                                    channels.pending.delete(channel_id);
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else if (split[1] === "friend") {
                            let response = await require("users/friend.js")(session, message);

                            if (response.status) {
                                if (!channels.pending.has(response.client.channel.id)) {
                                    channels.pending.set(response.client.channel.id, new Set());
                                }
                                const pending = channels.pending.get(response.client.channel.id);
                                const clients = users.get(session.user_id);
                                const recipients = users.get(response.client.channel.recipient.id);

                                if (clients) {
                                    response.client = JSON.stringify(response.client);
                                    for (let client of clients) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            pending.add(client);
                                            client.send(response.client);
                                        } else {
                                            clients.delete(client);
                                        }
                                    }
                                }

                                if (recipients) {
                                    response.recipient = JSON.stringify(response.recipient);
                                    for (let client of recipients) {
                                        if (client.readyState === WebSocket.OPEN) {
                                            pending.add(client);
                                            client.send(response.recipient);
                                        } else {
                                            recipients.delete(client);
                                        }
                                    }
                                }

                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify({
                                    status: true
                                }));
                            } else {
                                res.writeHead(200, {
                                    "Content-Type": "application/json"
                                });
                                res.end(JSON.stringify(response));
                            }
                        } else {
                            res.writeHead(404, {
                                "Content-Type": "text/html"
                            });
                            fs.createReadStream("404.html", "utf8").pipe(res);
                        }
                    }
                    break;
                    default:
                    {
                        res.writeHead(404, {
                            "Content-Type": "text/html"
                        });
                        fs.createReadStream("404.html", "utf8").pipe(res);
                    }
                }
            } catch (error) {
                res.writeHead(404, {
                    "Content-Type": "text/html"
                });
                fs.createReadStream("404.html", "utf8").pipe(res);
            }
        });
    }
}).listen(1337, "127.0.0.1");

const incomingRateLimit = ws => {
    if (!ws.date || Math.floor((Date.now() - ws.date) / 1000) > 10) {
        ws.date = Date.now();
        ws.count = 1;
    } else {
        ws.count++;
    }

    return ws.count <= 10;
}

wss.on("connection", (ws, req) => {
    ws.session = new (require("class/session.js"))(cookie.parse(req.headers.cookie, "token"));
    ws.on("message", async message => {
        try {
            message = JSON.parse(message);

            if (message.type === channel.DM_CHANNEL) {
                if (incomingRateLimit(ws)) {
                    let response = await require("send/channels.js")(ws.session, message);

                    if (response.status) {
                        const set = channels.dm.get(response.channel_id);
                        if (response.channel_id !== channel.EVERYONE) {
                            channel.markAsUnread(response.channel_id, ws.session.user_id);
                        }
                        response = JSON.stringify(response);
                        
                        for (let client of set) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(response);
                            } else {
                                set.delete(client);
                            }
                        }
                    } else {
                        ws.send(response);
                    }
                } else {
                    ws.terminate();
                }
            } else if (message.type === channel.TEXT_CHANNEL) {
                if (incomingRateLimit(ws)) {
                    let response = await require("send/guilds.js")(ws.session, message);

                    if (response.status) {
                        const set = channels.guild.get(response.channel_id);
                        response = JSON.stringify(response);

                        for (let client of set) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(response);
                            } else {
                                set.delete(client);
                            }
                        }
                    } else {
                        ws.send(response);
                    }
                } else {
                    ws.terminate();
                }
            } else if (message.type === channel.ACKNOWLEDGEMENT) {
                channel.markAsRead(message.channel_id, ws.session.user_id);
            } else if (message.type === "hello" || message.type === "reconnect") {
                if (!ws.hello) {
                    if (await ws.session.set()) {
                        ws.hello = true;
                        channels.dm.get(channel.EVERYONE).add(ws);

                        if (!users.has(ws.session.user_id)) {
                            users.set(ws.session.user_id, new Set());
                        }

                        users.get(ws.session.user_id).add(ws);

                        if (message.type === "hello") {
                            ws.send(JSON.stringify({
                                status: true,
                                type: "HELLO",
                                email: ws.session.email,
                                username: ws.session.username,
                                tag: ws.session.tag,
                                avatar: ws.session.avatar,
                                user_id: ws.session.user_id
                            }));
                        }

                        let response = await require("users/channels.js")(ws.session);
                        if (response.status) {
                            for (let channel of response.channels) {
                                if (!channels.dm.has(channel.id)) {
                                    channels.dm.set(channel.id, new Set());
                                }
                                channels.dm.get(channel.id).add(ws);
                            }
                            if (message.type === "hello") {
                                ws.send(JSON.stringify(response));
                            }
                        }

                        response = await require("users/guilds.js")(ws.session);
                        if (response.status) {
                            for (let guild of response.guilds) {
                                for (let channel of guild.channels) {
                                    if (!channels.guild.has(channel.id)) {
                                        channels.guild.set(channel.id, new Set());
                                    }
                                    channels.guild.get(channel.id).add(ws);
                                }
                            }
                            if (message.type === "hello") {
                                ws.send(JSON.stringify(response));
                            }
                        }

                        response = await require("users/pending.js")(ws.session);
                        if (response.status) {
                            for (let channel of response.pending) {
                                if (!channels.pending.has(channel.id)) {
                                    channels.pending.set(channel.id, new Set());
                                }
                                channels.pending.get(channel.id).add(ws);
                            }
                            if (message.type === "hello") {
                                ws.send(JSON.stringify(response));
                            }
                        }
                    } else {
                        ws.terminate();
                    }
                } else {
                    ws.terminate();
                }
            }
        } catch (error) {
            ws.terminate();
        }
    });
});

setInterval(() => {
    for (let ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }
}, 60000);

setInterval(() => {
    for (let [, set] of channels.dm) {
        for (let client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
    }

    for (let [, set] of channels.pending) {
        for (let client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
    }

    for (let [, set] of channels.guild) {
        for (let client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
    }

    for (let [key, set] of users) {
        for (let client of set) {
            if (client.readyState !== WebSocket.OPEN) {
                set.delete(client);
            }
        }
        if (set.size === 0) {
            users.delete(key);
        }
    }
}, 3600000);
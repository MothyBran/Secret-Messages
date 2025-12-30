// enterprise/socketServer.js
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const manager = require('./manager');
const crypto = require('crypto');
// We use the existing DB connection if possible, or a separate SQLite for Enterprise messages?
// The prompt says "Lokaler Hub (Server)... prüft seine lokale Datenbank".
// `server.js` initializes `db` (SQLite). We should reuse it.
// But `server.js` doesn't export `db`. We might need to query via a helper or pass db to this module.
// However, `enterprise/socketServer.js` is required by `server.js`.
// We can pass `db` or `dbQuery` during `attach`.

let dbQueryFn = null;

module.exports = {
    attach: (httpServer, queryFn) => {
        dbQueryFn = queryFn; // Function (sql, params) => Promise
        const io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        console.log("🔌 Enterprise Socket Server Attached");

        io.on("connection", (socket) => {
            console.log(`Socket connected: ${socket.id}`);

            // 1. Authentication
            socket.on("auth", async (data) => {
                const { username, accessCode } = data;
                const user = await manager.validateUser(username, accessCode);
                if (user) {
                    socket.user = user;
                    socket.join(`user:${user.id}`);
                    socket.join('global');
                    socket.emit("auth_success", {
                        username: user.username,
                        id: user.id,
                        openRecipient: user.isOpenRecipient
                    });

                    // Retrieve offline messages
                    if (dbQueryFn) {
                        try {
                            // Fetch unread messages for this user (using 'recipient_id' as username or ID?
                            // Enterprise users have ID "LOC-..." but messages might use username if typed manually?
                            // Let's stick to IDs or Usernames.
                            // Current `messages` table schema has `recipient_id` as INTEGER.
                            // But Enterprise uses String IDs ("LOC-...").
                            // We need to alter schema or use `username` matching if ID is string?
                            // `server.js` schema: `recipient_id INTEGER`.
                            // This is a PROBLEM. Enterprise IDs are strings.
                            // We should probably change `recipient_id` to TEXT or store in `metadata` or use a new table `enterprise_messages`.
                            // Let's create `enterprise_messages` table on init.

                            const msgs = await dbQueryFn('SELECT * FROM enterprise_messages WHERE recipient_id = ? AND is_read = 0', [user.id]);
                            if (msgs.rows && msgs.rows.length > 0) {
                                msgs.rows.forEach(m => {
                                    socket.emit("new_message", {
                                        id: m.id,
                                        sender: m.sender_id, // or name
                                        subject: m.subject,
                                        body: m.body,
                                        attachment: m.attachment,
                                        timestamp: m.created_at
                                    });
                                });
                            }
                        } catch (e) {
                            console.error("Offline Msg Error", e);
                        }
                    }

                } else {
                    socket.emit("auth_fail", { error: "Invalid Credentials" });
                }
            });

            // 2. Messaging (Store & Forward)
            socket.on("send_message", async (data) => {
                if (!socket.user) return; // Auth required

                // data: { recipientId, subject, body, attachmentBase64 }
                // recipientId is the Target User ID (e.g. LOC-xxx)

                const payload = {
                    id: 'MSG-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
                    sender: socket.user.username, // Send name for display
                    senderId: socket.user.id,
                    subject: data.subject,
                    body: data.body,
                    attachment: data.attachmentBase64,
                    timestamp: new Date().toISOString()
                };

                // Store in DB
                if (dbQueryFn) {
                    try {
                        await dbQueryFn(
                            `INSERT INTO enterprise_messages (id, sender_id, recipient_id, subject, body, attachment, created_at, is_read)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
                            [payload.id, socket.user.username, data.recipientId, payload.subject, payload.body, payload.attachment, payload.timestamp]
                        );
                    } catch(e) {
                        console.error("Msg Store Error", e);
                        socket.emit("error", "Message storage failed");
                        return;
                    }
                }

                // Try to deliver immediately if online
                // "io.to" works if user is in room. If not, it just does nothing (but we stored it).
                io.to(`user:${data.recipientId}`).emit("new_message", payload);

                socket.emit("message_sent", { id: payload.id });
            });

            // 3. Mark Read
            socket.on("mark_read", async (msgId) => {
                if(!socket.user || !dbQueryFn) return;
                await dbQueryFn('UPDATE enterprise_messages SET is_read = 1 WHERE id = ? AND recipient_id = ?', [msgId, socket.user.id]);
            });

            socket.on("disconnect", () => {});
        });
    }
};

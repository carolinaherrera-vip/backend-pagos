require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const app = express();

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// ================================
// 🧠 DB
// ================================
function getDB() {
    if (!fs.existsSync("db.json")) return {};
    return JSON.parse(fs.readFileSync("db.json"));
}

function saveDB(data) {
    fs.writeFileSync("db.json", JSON.stringify(data, null, 2));
}

// 🔥 ANTI MULTI-CUENTA
function guardarUsuario(id, customerId, activo = true) {
    const data = getDB();

    for (let user in data) {
        if (data[user].customer_id === customerId && user != id) {
            expulsarUsuario(user);
            data[user].activo = false;

            bot.sendMessage(user, "⚠️ Tu cuenta fue usada en otro dispositivo. Acceso revocado.");
        }
    }

    data[id] = {
        ...data[id],
        activo,
        customer_id: customerId,
        actualizado: Date.now()
    };

    saveDB(data);
}

function usuarioActivo(id) {
    const data = getDB();
    return data[id]?.activo === true;
}

async function expulsarUsuario(telegramId) {
    try {
        await bot.banChatMember(process.env.GROUP_ID, telegramId);
        await bot.unbanChatMember(process.env.GROUP_ID, telegramId);
    } catch (err) {}
}

// ================================
// 🌐 BASE
// ================================
app.get("/", (req, res) => {
    res.send("🔥 Backend funcionando");
});

// ================================
// 💳 CREAR PAGO
// ================================
app.get("/crear-pago", async (req, res) => {
    try {
        const telegramId = req.query.user_id;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",

            client_reference_id: telegramId,

            metadata: {
                telegram_id: telegramId
            },

            line_items: [
                {
                    price: "price_1TPF5sADvKSan3qmxPgBdJWB",
                    quantity: 1,
                },
            ],

            success_url: "https://carolinaherrera-vip.github.io/mi-pagina/gracias.html",
            cancel_url: "https://carolinaherrera-vip.github.io/mi-pagina/cancelado.html"
        });

        res.redirect(session.url);

    } catch (error) {
        res.status(500).send(error.message);
    }
});

// ================================
// 🔔 WEBHOOK
// ================================
app.post("/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        return res.sendStatus(400);
    }

    // ✅ PAGO COMPLETADO
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const telegramId =
            session.client_reference_id ||
            session.metadata?.telegram_id;

        const customerId = session.customer;

        guardarUsuario(telegramId, customerId, true);

        if (telegramId) {
            bot.sendMessage(
                telegramId,
                "🔥 Pago confirmado.\n\n👉 Presiona *Solicitar acceso* para entrar al grupo.",
                { parse_mode: "Markdown" }
            );
        }
    }

    // ✅ RENOVACIÓN
    if (event.type === "invoice.payment_succeeded") {
        const invoice = event.data.object;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        const telegramId = subscription.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, invoice.customer, true);
        }
    }

    // ❌ CANCELACIÓN
    if (event.type === "customer.subscription.deleted") {
        const telegramId = event.data.object.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, null, false);
            expulsarUsuario(telegramId);
        }
    }

    // ❌ FALLÓ PAGO
    if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        const telegramId = subscription.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, null, false);
            await expulsarUsuario(telegramId);

            bot.sendMessage(
                telegramId,
                "❌ Tu pago falló.\n\nHas sido removido del VIP."
            );

            await stripe.subscriptions.cancel(invoice.subscription);
        }
    }

    res.sendStatus(200);
});

// ================================
// 🤖 BOT
// ================================
const cooldown = {};

// 🚀 START con deep link
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const userId = msg.chat.id;
    const param = match[1];

    let mensaje = `🔥 Bienvenido al VIP

👇 Elige una opción:`;

    if (param === "vip") {
        mensaje = `🔥 Acceso VIP

Estás a un paso de entrar 👇`;
    }

    bot.sendMessage(userId, mensaje, {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "💳 Comprar acceso",
                        url: `${process.env.BASE_URL}/crear-pago?user_id=${userId}`
                    }
                ],
                [
                    {
                        text: "🚀 Solicitar acceso",
                        url: "https://t.me/+LBDVFAD16aEwMTJh"
                    }
                ]
            ]
        }
    });
});

// 🔥 AUTO RESPUESTA SI ESCRIBE ALGO
bot.on("message", (msg) => {
    const userId = msg.chat.id;

    if (msg.text && msg.text.startsWith("/")) return;

    if (cooldown[userId] && Date.now() - cooldown[userId] < 5000) return;

    cooldown[userId] = Date.now();

    bot.sendMessage(userId,

`¡INDICACIONES A SEGUIR!⚠️🚨
1.Realiza tu pago en "Comprar acceso".
2.Una vez completado el pago, dar click en "Solicitar acceso", de lo contrario, el bot rehazará su acceso.
👇Usa los botones para continuar:`,
{
    reply_markup: {
        inline_keyboard: [
            [
                {
                    text: "💳 Comprar acceso",
                    url: `${process.env.BASE_URL}/crear-pago?user_id=${userId}`
                }
            ],
            [
                {
                    text: "🚀 Solicitar acceso",
                    url: "https://t.me/+LBDVFAD16aEwMTJh"
                }
            ]
        ]
    }
});
});

// ================================
// 🔥 APROBAR SOLICITUDES
// ================================
bot.on("chat_join_request", async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (usuarioActivo(userId)) {
        await bot.approveChatJoinRequest(chatId, userId);
        bot.sendMessage(userId, "🔥 Acceso aprobado. Bienvenido al VIP.");
    } else {
        await bot.declineChatJoinRequest(chatId, userId);
        bot.sendMessage(userId, "❌ No tienes acceso activo.");
    }
});

// ================================
// 🚫 ANTI INTRUSOS
// ================================
bot.on("new_chat_members", async (msg) => {
    const chatId = msg.chat.id;

    for (let user of msg.new_chat_members) {
        if (!usuarioActivo(user.id)) {
            await bot.banChatMember(chatId, user.id);
            await bot.unbanChatMember(chatId, user.id);

            console.log("🚫 Intruso expulsado:", user.id);
        } else {
            console.log("✅ Cliente válido entró:", user.id);
        }
    }
});

// ================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Servidor corriendo en puerto", PORT);
});

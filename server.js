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

// 🔥 FUNCIÓN MEJORADA (ANTI MULTI-CUENTA)
function guardarUsuario(id, customerId, activo = true) {
    const data = getDB();

    // 🔒 Evita que una suscripción se use en múltiples cuentas
    for (let user in data) {
        if (data[user].customer_id === customerId && user != id) {
            expulsarUsuario(user);
            data[user].activo = false;
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

function guardarLink(id, linkData) {
    const data = getDB();

    data[id] = {
        ...data[id],
        invite_link: linkData.invite_link,
        expire_date: linkData.expire_date
    };

    saveDB(data);
}

function obtenerLink(id) {
    const data = getDB();
    return data[id];
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

        const userData = obtenerLink(telegramId);
        let link;

        const ahora = Math.floor(Date.now() / 1000);

        if (
            userData?.invite_link &&
            userData?.expire_date > ahora
        ) {
            link = userData.invite_link;
        } else {
            const newLink = await bot.createChatInviteLink(
                process.env.GROUP_ID,
                {
                    member_limit: 1,
                    expire_date: ahora + 300
                }
            );

            guardarLink(telegramId, newLink);
            link = newLink.invite_link;
        }

        if (telegramId) {
            bot.sendMessage(
                telegramId,
                `🔥 Acceso activado:\n${link}`
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
        // ❌ quitar acceso
        guardarUsuario(telegramId, null, false);
        await expulsarUsuario(telegramId);

        // 💬 aviso claro
        bot.sendMessage(
            telegramId,
            "❌ Tu pago mensual falló.\n\nHas sido removido del VIP automáticamente.\n\n💳 Puedes volver a entrar pagando nuevamente."
        );

        // 🔥 OPCIONAL PERO MUY POWER:
        // cancelar la suscripción para que Stripe NO siga intentando
        await stripe.subscriptions.cancel(invoice.subscription);
    }
}

    res.sendStatus(200);
});

// ================================
// 🤖 BOT
// ================================
const cooldown = {};

// 🚀 START
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;

    bot.sendMessage(userId,
`🔥 Bienvenido al VIP

Accede a contenido exclusivo

👇 Elige tu acceso:`,
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
                    text: "🔓 Ya pagué",
                    callback_data: "check_access"
                }
            ]
        ]
    }
});
});

// 🎯 BOTÓN CONTROLADO
bot.on("callback_query", async (query) => {
    const userId = query.message.chat.id;

    if (query.data === "check_access") {

        const ahora = Date.now();

        // ⛔ ANTI SPAM
        if (cooldown[userId] && ahora - cooldown[userId] < 10000) {
            return bot.answerCallbackQuery(query.id, {
                text: "⏳ Espera unos segundos...",
            });
        }

        cooldown[userId] = ahora;

        if (!usuarioActivo(userId)) {
            return bot.sendMessage(userId, "❌ No tienes acceso activo");
        }

        const userData = obtenerLink(userId);
        const ahoraUnix = Math.floor(Date.now() / 1000);

        let link;

        if (
            userData?.invite_link &&
            userData?.expire_date > ahoraUnix
        ) {
            link = userData.invite_link;
        } else {
            const newLink = await bot.createChatInviteLink(
                process.env.GROUP_ID,
                {
                    member_limit: 1,
                    expire_date: ahoraUnix + 300
                }
            );

            guardarLink(userId, newLink);
            link = newLink.invite_link;
        }

        bot.sendMessage(userId, `🔥 Acceso:\n${link}`);
    }
});

// ================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Servidor corriendo en puerto", PORT);
});

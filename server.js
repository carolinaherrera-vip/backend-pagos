require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const app = express();
console.log("🚀 DEPLOY TEST - servidor iniciado"); // 👈 AQUÍ

// ✅ SOLUCIÓN PRO
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// 🔐 CONFIG
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});
// 🔥 DEBUG CRÍTICO (NUEVO)
// Eliminar webhook correctamente
bot.deleteWebHook()
    .then(() => {
        console.log("🚫 Webhook eliminado");
    })
    .catch((err) => {
        console.log("❌ Error eliminando webhook:", err.message);
    });

// Verificar que el bot funciona
bot.getMe()
    .then((me) => {
        console.log("🤖 BOT ACTIVO:", me.username);
    })
    .catch((err) => {
        console.log("❌ ERROR BOT:", err.message);
    });
// ================================
// 🧠 DB
// ================================
function guardarUsuario(id, customerId, activo = true) {
    let data = {};

    if (fs.existsSync("db.json")) {
        data = JSON.parse(fs.readFileSync("db.json"));
    }

    for (let user in data) {
        if (data[user].customer_id === customerId && user != id) {
            expulsarUsuario(user);
            data[user].activo = false;
        }
    }

    data[id] = {
        activo,
        customer_id: customerId,
        actualizado: Date.now()
    };

    fs.writeFileSync("db.json", JSON.stringify(data, null, 2));
}

function usuarioActivo(id) {
    if (!fs.existsSync("db.json")) return false;
    const data = JSON.parse(fs.readFileSync("db.json"));
    return data[id]?.activo === true;
}

async function expulsarUsuario(telegramId) {
    try {
        await bot.banChatMember(process.env.GROUP_ID, telegramId);
        await bot.unbanChatMember(process.env.GROUP_ID, telegramId);
    } catch (err) {
        console.log("Error expulsando:", err.message);
    }
}

// ================================
// 🌐 RUTA BASE (IMPORTANTE)
// ================================
app.get("/", (req, res) => {
    res.send("🔥 Backend funcionando correctamente");
});

// ================================
// 💳 CREAR PAGO
// ================================
app.get("/crear-pago", async (req, res) => {
    try {
        const telegramId = req.query.user_id;

        if (!telegramId) {
            return res.send("❌ Falta user_id");
        }

       const session = await stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  mode: "subscription",

  client_reference_id: telegramId,

  metadata: {
    telegram_id: telegramId
  },

  subscription_data: {
    metadata: {
      telegram_id: telegramId
    },

    // 🔥 ESTA ES LA CLAVE
    description: "CAROLINA VIP"
  },

  line_items: [
    {
      price_data: {
        currency: "usd",
        product_data: {
          name: "CAROLINA VIP", // 👈 cambia esto también
        },
        unit_amount: 3000,
        recurring: {
          interval: "month",
        },
      },
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

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const telegramId =
            session.client_reference_id ||
            session.metadata?.telegram_id;

        const customerId = session.customer;

        guardarUsuario(telegramId, customerId, true);

        const link = await bot.createChatInviteLink(
            process.env.GROUP_ID,
            { member_limit: 1 }
        );

        // ✅ VALIDACIÓN CRÍTICA AÑADIDA
        if (telegramId) {
            bot.sendMessage(
                telegramId,
                `🔥 Acceso activado:\n${link.invite_link}`
            );
        } else {
            console.log("⚠️ telegramId no encontrado en checkout.session.completed");
        }
    }
    
    if (event.type === "invoice.payment_succeeded") {
        const invoice = event.data.object;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        const telegramId = subscription.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, invoice.customer, true);
        }
    }

    if (event.type === "customer.subscription.deleted") {
        const telegramId = event.data.object.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, null, false);
            expulsarUsuario(telegramId);
        }
    }

    if (event.type === "invoice.payment_failed") {
        const telegramId = event.data.object.metadata?.telegram_id;

        if (telegramId) {
            guardarUsuario(telegramId, null, false);
            expulsarUsuario(telegramId);
        }
    }

    res.sendStatus(200);
});

// ================================
// 🤖 BOT
// ================================

// 🔥 DEBUG TOTAL
bot.on("message", (msg) => {
    console.log("📩 MENSAJE DETECTADO:");
    console.log(JSON.stringify(msg, null, 2));
});

// 🔥 NUEVO: detectar cambios en el grupo
bot.on("my_chat_member", (msg) => {
    console.log("👀 CAMBIO EN EL CHAT:");
    console.log(JSON.stringify(msg, null, 2));
});

// 🔥 NUEVO: detectar nuevos miembros
bot.on("new_chat_members", (msg) => {
    console.log("👥 NUEVO MIEMBRO:");
    console.log(JSON.stringify(msg, null, 2));
});

// 🚀 COMANDO START
bot.onText(/\/start/, (msg) => {
    const userId = msg.chat.id;

    bot.sendMessage(userId,
`🔥 Bienvenido al VIP

Accede a contenido exclusivo y comunidad privada.

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

// 🎯 BOTÓN
bot.on("callback_query", async (query) => {
    const userId = query.message.chat.id;

    if (query.data === "check_access") {
        if (usuarioActivo(userId)) {
            const link = await bot.createChatInviteLink(
                process.env.GROUP_ID,
                { member_limit: 1 }
            );

            bot.sendMessage(userId, `🔥 Acceso concedido:\n${link.invite_link}`);
        } else {
            bot.sendMessage(userId, "❌ No tienes acceso activo");
        }
    }
});

// ================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Servidor corriendo en puerto", PORT);
});

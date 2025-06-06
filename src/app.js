import path from 'path'
import fs from 'fs'
import cron from 'node-cron'
import { createBot, createProvider, createFlow, addKeyword, utils } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'

const PORT = process.env.PORT ?? 3008

// Configuración de directorios para Docker
const DATA_DIR = path.join(process.cwd(), 'data')
const RECORDATORIOS_FILE = path.join(DATA_DIR, 'recordatorios.json')

// Crear directorio data si no existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    console.log('📁 Directorio data creado')
}

const guardaRecordatorio = (recordatorio) => {
    try {
        let recordatorios = [];
        
        // Verificar si el archivo existe
        if (fs.existsSync(RECORDATORIOS_FILE)) {
            const data = fs.readFileSync(RECORDATORIOS_FILE, 'utf-8');
            recordatorios = data ? JSON.parse(data) : [];
        }
        
        recordatorios.push(recordatorio);
        fs.writeFileSync(RECORDATORIOS_FILE, JSON.stringify(recordatorios, null, 2));
        console.log('Recordatorio guardado correctamente:', recordatorio);
        return true;
    } catch (error) {
        console.error('Error guardando recordatorio:', error);
        return false;
    }
};

const leerRecordatorios = () => {
    try {
        if (!fs.existsSync(RECORDATORIOS_FILE)) {
            return [];
        }
        const data = fs.readFileSync(RECORDATORIOS_FILE, 'utf-8');
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Error leyendo recordatorios:', error);
        return [];
    }
};

const actualizarRecordatorios = (recordatorios) => {
    try {
        fs.writeFileSync(RECORDATORIOS_FILE, JSON.stringify(recordatorios, null, 2));
        return true;
    } catch (error) {
        console.error('Error actualizando recordatorios:', error);
        return false;
    }
};

const recordatorioFlow = addKeyword('recordatorio')
    .addAnswer('📝 *¿Cuál es el título del recordatorio?*', { capture: true }, async (ctx, { state }) => {
        await state.update({ titulo: ctx.body });
    })
    .addAnswer('✏️ *Describe el recordatorio:*', { capture: true }, async (ctx, { state }) => {
        await state.update({ descripcion: ctx.body });
    })
    .addAnswer('📅 *Fecha (DD/MM/AAAA):*', { capture: true }, async (ctx, { state }) => {
        await state.update({ fecha: ctx.body });
    })
    .addAnswer('⏰ *Hora (HH:MM):*', { capture: true }, async (ctx, { state }) => {
        await state.update({ hora: ctx.body });
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        const { titulo, descripcion, fecha, hora } = state.getMyState();
        const chatId = ctx.from;
        
        const exito = guardaRecordatorio({
            id: Date.now().toString(),
            chatId,
            titulo,
            descripcion,
            fecha,
            hora,
            enviado: false
        });

        if (exito) {
            await flowDynamic(`✅ *Recordatorio guardado:*\n📌 *${titulo}*\n📅 *Fecha:* ${fecha}\n⏰ *Hora:* ${hora}`);
        } else {
            await flowDynamic('❌ Error al guardar el recordatorio. Intenta nuevamente.');
        }
    });

const iniciarCronRecordatorios = (adapterProvider) => {
    console.log('🕒 Iniciando cron job de recordatorios...');

    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const recordatorios = leerRecordatorios();
            let hayActualizaciones = false;

            console.log(`📋 Revisando ${recordatorios.length} recordatorios...`);

            const bot = adapterProvider.getInstance();
            if (!bot) {
                console.error('❌ Bot es undefined en cron. Asegurate de que WPPConnect esté conectado.');
                return;
            }

            for (const recordatorio of recordatorios) {
                if (recordatorio.enviado) continue;

                try {
                    const [dia, mes, anio] = recordatorio.fecha.split('/');
                    const [hora, minuto] = recordatorio.hora.split(':');
                    const fechaRecordatorio = new Date(anio, mes - 1, dia, hora, minuto);

                    if (ahora >= fechaRecordatorio) {
                        console.log(`📤 Enviando recordatorio: ${recordatorio.titulo}`);

                        await bot.sendText(
                            recordatorio.chatId,
                            `🔔 *Recordatorio:* ${recordatorio.titulo}\n${recordatorio.descripcion}`
                        );

                        recordatorio.enviado = true;
                        hayActualizaciones = true;

                        console.log(`✅ Recordatorio enviado: ${recordatorio.titulo}`);
                    }
                } catch (errorRecordatorio) {
                    console.error('❌ Error procesando recordatorio individual:', errorRecordatorio);
                }
            }

            if (hayActualizaciones) {
                actualizarRecordatorios(recordatorios);
                console.log('💾 Recordatorios actualizados');
            }
        } catch (error) {
            console.error('❌ Error en cron job de recordatorios:', error);
        }
    });

    console.log('✅ Cron job de recordatorios iniciado correctamente');
};

const main = async () => {
    try {
        console.log('🚀 Iniciando WhatsApp Bot...');
        console.log(`📁 Directorio de trabajo: ${process.cwd()}`);
        console.log(`💾 Archivo de recordatorios: ${RECORDATORIOS_FILE}`);
        
        const adapterFlow = createFlow([recordatorioFlow])
        const adapterProvider = createProvider(Provider)
        const adapterDB = new Database()

        const { handleCtx, httpServer } = await createBot({
            flow: adapterFlow,
            provider: adapterProvider,
            database: adapterDB,
        })

        iniciarCronRecordatorios(adapterProvider);

        // Endpoints de la API
        adapterProvider.server.post(
            '/v1/messages',
            handleCtx(async (bot, req, res) => {
                const { number, message, urlMedia } = req.body
                await bot.sendMessage(number, message, { media: urlMedia ?? null })
                return res.end('sended')
            })
        )

        adapterProvider.server.post(
            '/v1/register',
            handleCtx(async (bot, req, res) => {
                const { number, name } = req.body
                await bot.dispatch('REGISTER_FLOW', { from: number, name })
                return res.end('trigger')
            })
        )

        adapterProvider.server.post(
            '/v1/samples',
            handleCtx(async (bot, req, res) => {
                const { number, name } = req.body
                await bot.dispatch('SAMPLES', { from: number, name })
                return res.end('trigger')
            })
        )

        adapterProvider.server.post(
            '/v1/blacklist',
            handleCtx(async (bot, req, res) => {
                const { number, intent } = req.body
                if (intent === 'remove') bot.blacklist.remove(number)
                if (intent === 'add') bot.blacklist.add(number)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ status: 'ok', number, intent }))
            })
        )

        httpServer(+PORT)
        console.log(`🚀 Bot iniciado correctamente en puerto ${PORT}`);
        
    } catch (error) {
        console.error('❌ Error iniciando el bot:', error);
        process.exit(1);
    }
}

main()
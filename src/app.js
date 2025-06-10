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

// FUNCIONES AUXILIARES (mover al inicio)
function normalizarTexto(texto) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parsearFecha(input) {
  const hoy = new Date();
  const expresiones = {
    'hoy': () => formatearFecha(hoy),
    'manana': () => formatearFecha(agregarDias(hoy, 1)),
    'pasado manana': () => formatearFecha(agregarDias(hoy, 2)),
    'en (\\d+) dias': (dias) => formatearFecha(agregarDias(hoy, parseInt(dias)))
  };

  // Buscar coincidencia con expresiones especiales
  for (const [expresion, fn] of Object.entries(expresiones)) {
    const match = input.match(new RegExp(`^${expresion}$`));
    if (match) return fn(...match.slice(1));
  }

  // Validar formato DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [dia, mes, anio] = input.split('/');
    const fecha = new Date(`${anio}-${mes}-${dia}T12:00:00`);
    
    // Verificar que la fecha sea válida y coherente
    if (!isNaN(fecha.getTime()) && 
        fecha.getDate() == dia && 
        fecha.getMonth() + 1 == mes) {
      return input;
    }
  }

  return null;
}

function formatearFecha(date) {
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${date.getFullYear()}`;
}

function agregarDias(fecha, dias) {
  const nuevaFecha = new Date(fecha);
  nuevaFecha.setDate(fecha.getDate() + dias);
  return nuevaFecha;
}

// FUNCIONES DE ARCHIVO
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

// FLUJOS (declarar todos antes de usar)
// Flujo para finalizar y guardar el recordatorio
const finalizarRecordatorioFlow = addKeyword(['finalizar_recordatorio'])
  .addAction(async (ctx, { state, flowDynamic }) => {
    const { titulo, descripcion, fecha, hora } = state.getMyState();
    
    if (!titulo || !descripcion || !fecha || !hora) {
      return flowDynamic('❌ No se pudo crear el recordatorio. Faltan datos.');
    }

    const exito = guardaRecordatorio({
      id: Date.now().toString(),
      chatId: ctx.from,
      titulo,
      descripcion,
      fecha,
      hora,
      enviado: false
    });

    if (exito) {
      await flowDynamic(`✅ *Recordatorio guardado:*\n📌 *Titulo:* ${titulo}\n ✏️ *Descripción:* ${descripcion}\n 📅 *Fecha:* ${fecha}\n⏰ *Hora:* ${hora}`);
    } else {
      await flowDynamic('❌ Error al guardar. Intenta nuevamente.');
    }
    
    // Limpiar el estado
    await state.clear();
  });

// Flujo separado para solicitar hora
const solicitarHoraFlow = addKeyword(['solicitar_hora'])
  .addAnswer('⏰ *Hora (HH:MM):*',
    { capture: true },
    async (ctx, { state, flowDynamic, gotoFlow }) => {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(ctx.body)) {
        await flowDynamic([
          `❌ Formato de hora inválido. Usa HH:MM (ej: 14:30)\n`,
          `Por favor, ingresa una hora válida:`
        ]);
        return gotoFlow(solicitarHoraFlow);
      }
      await state.update({ hora: ctx.body });
      return gotoFlow(finalizarRecordatorioFlow);
    });

// Flujo separado para solicitar fecha nuevamente
const solicitarFechaFlow = addKeyword(['fecha_invalida'])
  .addAnswer('📅 *Fecha (DD/MM/AAAA, "hoy", "mañana", "en X días"):*',
    { capture: true },
    async (ctx, { state, flowDynamic, gotoFlow }) => {
      try {
        const fechaInput = normalizarTexto(ctx.body);
        const fechaCalculada = parsearFecha(fechaInput);
        
        if (!fechaCalculada) {
          await flowDynamic([
            '❌ *Fecha no válida*',
            `*Ejemplos aceptados:*\n *• hoy*\n *• mañana*\n *• en 3 días* \n *• 25/12/2023 (DD/MM/AAAA)*\n Por favor, ingresa una fecha válida:`
          ]);
          return gotoFlow(solicitarFechaFlow);
        }
        
        await state.update({ fecha: fechaCalculada });
        return gotoFlow(solicitarHoraFlow);
      } catch (error) {
        console.error('Error procesando fecha:', error);
        await flowDynamic('⚠️ Ocurrió un error. Por favor intenta nuevamente.');
        return gotoFlow(solicitarFechaFlow);
      }
    });

// Flujo principal de recordatorios (cambiar keyword para evitar conflictos)
const recordatorioFlow = addKeyword(['.recordatorio', '.r'])
  .addAnswer('📝 *¿Cuál es el título del recordatorio?*', 
    { capture: true }, 
    async (ctx, { state }) => {
      await state.update({ titulo: ctx.body });
    })
  .addAnswer('✏️ *Describe el recordatorio:*', 
    { capture: true }, 
    async (ctx, { state, gotoFlow }) => {
      await state.update({ descripcion: ctx.body });
      return gotoFlow(solicitarFechaFlow);
    });

// FUNCIÓN CRON
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
                            `🔔 *Recordatorio:* ${recordatorio.titulo}\n ✏️ *Descripción:* ${recordatorio.descripcion}`
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

// FUNCIÓN MAIN
const main = async () => {
    try {
        const adapterFlow = createFlow([
            recordatorioFlow,
            solicitarFechaFlow,
            solicitarHoraFlow,
            finalizarRecordatorioFlow
        ])
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
        console.log(`🚀 Bot iniciado en puerto ${PORT}`);
        
    } catch (error) {
        console.error('❌ Error iniciando el bot:', error);
        process.exit(1);
    }
}

main()

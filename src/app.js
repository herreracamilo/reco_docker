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

// Crear directorio data si no existe con permisos correctos
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o755 })
        console.log('📁 Directorio data creado con permisos 755')
        
        // Verificar permisos de escritura
        fs.accessSync(DATA_DIR, fs.constants.W_OK)
        console.log('✅ Permisos de escritura verificados')
    } catch (error) {
        console.error('❌ Error creando directorio o verificando permisos:', error)
        process.exit(1)
    }
}

// Inicializar archivo de recordatorios si no existe
if (!fs.existsSync(RECORDATORIOS_FILE)) {
    try {
        fs.writeFileSync(RECORDATORIOS_FILE, '[]', { mode: 0o644 })
        console.log('📄 Archivo de recordatorios inicializado')
    } catch (error) {
        console.error('❌ Error inicializando archivo de recordatorios:', error)
    }
}

// FUNCIONES AUXILIARES
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

// FUNCIONES DE ARCHIVO CON MEJOR MANEJO DE ERRORES
const guardaRecordatorio = (recordatorio) => {
    try {
        let recordatorios = [];
        
        if (fs.existsSync(RECORDATORIOS_FILE)) {
            const data = fs.readFileSync(RECORDATORIOS_FILE, 'utf-8');
            recordatorios = data ? JSON.parse(data) : [];
        }
        
        recordatorios.push(recordatorio);
        
        // Intentar escribir con permisos específicos
        fs.writeFileSync(RECORDATORIOS_FILE, JSON.stringify(recordatorios, null, 2), { 
            mode: 0o644,
            flag: 'w'
        });
        
        console.log('✅ Recordatorio guardado correctamente:', recordatorio.titulo);
        return true;
    } catch (error) {
        console.error('❌ Error guardando recordatorio:', error);
        console.error('Detalles del error:', {
            code: error.code,
            path: error.path,
            message: error.message
        });
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
        console.error('❌ Error leyendo recordatorios:', error);
        return [];
    }
};

const actualizarRecordatorios = (recordatorios) => {
    try {
        fs.writeFileSync(RECORDATORIOS_FILE, JSON.stringify(recordatorios, null, 2), {
            mode: 0o644,
            flag: 'w'
        });
        return true;
    } catch (error) {
        console.error('❌ Error actualizando recordatorios:', error);
        return false;
    }
};

// ESTADO GLOBAL PARA MANEJAR PROCESOS EN CURSO
const procesosEnCurso = new Map();

// FLUJO PRINCIPAL DE RECORDATORIOS - VERSIÓN MEJORADA
const recordatorioFlow = addKeyword(['.recordatorio', '.r'])
  .addAction(async (ctx, { state, flowDynamic }) => {
    const userId = ctx.from;
    
    // Verificar si hay un proceso en curso
    if (procesosEnCurso.has(userId)) {
      await flowDynamic('⚠️ Ya tienes un recordatorio en proceso. Usa ".cancelar" para cancelarlo o complétalo primero.');
      return { endFlow: true };
    }
    
    // Iniciar nuevo proceso
    procesosEnCurso.set(userId, {
      paso: 'esperando_titulo',
      iniciado: Date.now(),
      datos: {}
    });
    
    await state.clear();
    console.log(`🔄 Iniciando proceso de recordatorio para ${userId}`);
  })
  .addAnswer('📝 *¿Cuál es el título del recordatorio?*', 
    { capture: true }, 
    async (ctx, { state, flowDynamic, endFlow }) => {
      const userId = ctx.from;
      const proceso = procesosEnCurso.get(userId);
      
      if (!proceso || proceso.paso !== 'esperando_titulo') {
        await flowDynamic('❌ Error en el proceso. Empezando de nuevo...');
        procesosEnCurso.delete(userId);
        return endFlow();
      }
      
      const titulo = ctx.body.trim();
      
      // Verificar que no sea un comando
      if (titulo.startsWith('.')) {
        await flowDynamic('❌ El título no puede ser un comando. Por favor ingresa un título válido:');
        return;
      }
      
      proceso.datos.titulo = titulo;
      proceso.paso = 'esperando_descripcion';
      procesosEnCurso.set(userId, proceso);
      
      console.log(`📝 Título guardado para ${userId}: ${titulo}`);
    })
  .addAnswer('✏️ *Describe el recordatorio:*', 
    { capture: true }, 
    async (ctx, { state, flowDynamic, endFlow }) => {
      const userId = ctx.from;
      const proceso = procesosEnCurso.get(userId);
      
      if (!proceso || proceso.paso !== 'esperando_descripcion') {
        await flowDynamic('❌ Error en el proceso. Empezando de nuevo...');
        procesosEnCurso.delete(userId);
        return endFlow();
      }
      
      const descripcion = ctx.body.trim();
      
      // Verificar que no sea un comando
      if (descripcion.startsWith('.')) {
        await flowDynamic('❌ La descripción no puede ser un comando. Por favor ingresa una descripción válida:');
        return;
      }
      
      proceso.datos.descripcion = descripcion;
      proceso.paso = 'esperando_fecha';
      procesosEnCurso.set(userId, proceso);
      
      console.log(`✏️ Descripción guardada para ${userId}: ${descripcion}`);
    })
  .addAnswer('📅 *Fecha (DD/MM/AAAA, "hoy", "mañana", "en X días"):*',
    { capture: true },
    async (ctx, { state, flowDynamic, endFlow }) => {
      const userId = ctx.from;
      const proceso = procesosEnCurso.get(userId);
      
      if (!proceso || proceso.paso !== 'esperando_fecha') {
        await flowDynamic('❌ Error en el proceso. Empezando de nuevo...');
        procesosEnCurso.delete(userId);
        return endFlow();
      }

      const fechaInput = normalizarTexto(ctx.body);
      
      // Verificar que no sea un comando
      if (ctx.body.trim().startsWith('.')) {
        await flowDynamic('❌ Por favor ingresa una fecha válida, no un comando:');
        return;
      }
      
      const fechaCalculada = parsearFecha(fechaInput);
      
      if (!fechaCalculada) {
        await flowDynamic([
          '❌ *Fecha no válida*',
          `*Ejemplos aceptados:*\n• *hoy*\n• *mañana*\n• *en 3 días*\n• *25/12/2024 (DD/MM/AAAA)*`,
          `Por favor, ingresa una fecha válida:`
        ]);
        return;
      }
      
      proceso.datos.fecha = fechaCalculada;
      proceso.paso = 'esperando_hora';
      procesosEnCurso.set(userId, proceso);
      
      console.log(`📅 Fecha guardada para ${userId}: ${fechaCalculada}`);
    })
  .addAnswer('⏰ *Hora (HH:MM):*',
    { capture: true },
    async (ctx, { state, flowDynamic, endFlow }) => {
      const userId = ctx.from;
      const proceso = procesosEnCurso.get(userId);
      
      if (!proceso || proceso.paso !== 'esperando_hora') {
        await flowDynamic('❌ Error en el proceso. Empezando de nuevo...');
        procesosEnCurso.delete(userId);
        return endFlow();
      }

      const horaInput = ctx.body.trim();
      
      // Verificar que no sea un comando
      if (horaInput.startsWith('.')) {
        await flowDynamic('❌ Por favor ingresa una hora válida, no un comando:');
        return;
      }

      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(horaInput)) {
        await flowDynamic([
          `❌ Formato de hora inválido. Usa HH:MM (ej: 14:30)`,
          `Por favor, ingresa una hora válida:`
        ]);
        return;
      }

      // Completar el recordatorio
      const { titulo, descripcion, fecha } = proceso.datos;
      const hora = horaInput;

      const recordatorio = {
        id: Date.now().toString(),
        chatId: userId,
        titulo,
        descripcion,
        fecha,
        hora,
        enviado: false,
        creado: new Date().toISOString()
      };

      const exito = guardaRecordatorio(recordatorio);

      if (exito) {
        await flowDynamic([
          `✅ *Recordatorio guardado exitosamente:*`,
          `📌 *Título:* ${titulo}`,
          `✏️ *Descripción:* ${descripcion}`,
          `📅 *Fecha:* ${fecha}`,
          `⏰ *Hora:* ${hora}`,
          ``,
          `🔔 Te recordaré el ${fecha} a las ${hora}`
        ]);
        
        console.log(`✅ Recordatorio completado para ${userId}`);
      } else {
        await flowDynamic('❌ Error al guardar el recordatorio. Verifica los permisos del archivo. Intenta nuevamente con .r');
      }
      
      // Limpiar el proceso
      procesosEnCurso.delete(userId);
      await state.clear();
    });

// Flujo para cancelar recordatorio en curso - MEJORADO
const cancelarFlow = addKeyword(['.cancelar', 'cancelar'])
  .addAction(async (ctx, { state, flowDynamic }) => {
    const userId = ctx.from;
    
    if (procesosEnCurso.has(userId)) {
      procesosEnCurso.delete(userId);
      await state.clear();
      await flowDynamic('❌ Recordatorio cancelado. Puedes empezar uno nuevo con .r');
    } else {
      await flowDynamic('ℹ️ No hay ningún recordatorio en proceso para cancelar.');
    }
  });

// Flujo para ver recordatorios pendientes
const verRecordatoriosFlow = addKeyword(['.ver', '.lista'])
  .addAction(async (ctx, { flowDynamic }) => {
    try {
      const recordatorios = leerRecordatorios();
      const recordatoriosPendientes = recordatorios.filter(r => 
        !r.enviado && r.chatId === ctx.from
      );

      if (recordatoriosPendientes.length === 0) {
        await flowDynamic('📋 No tienes recordatorios pendientes.');
        return;
      }

      let mensaje = '📋 *Tus recordatorios pendientes:*\n\n';
      recordatoriosPendientes.forEach((r, index) => {
        mensaje += `${index + 1}. 📌 *${r.titulo}*\n`;
        mensaje += `   📅 ${r.fecha} ⏰ ${r.hora}\n`;
        mensaje += `   ✏️ ${r.descripcion}\n\n`;
      });

      await flowDynamic(mensaje);
    } catch (error) {
      console.error('❌ Error listando recordatorios:', error);
      await flowDynamic('❌ Error al obtener los recordatorios.');
    }
  });

// Flujo de ayuda
const ayudaFlow = addKeyword(['.ayuda', '.help'])
  .addAction(async (ctx, { flowDynamic }) => {
    await flowDynamic([
      '🤖 *Comandos disponibles:*',
      '',
      '📝 *.r* o *.recordatorio* - Crear nuevo recordatorio',
      '📋 *.ver* o *.lista* - Ver recordatorios pendientes',
      '❌ *.cancelar* - Cancelar recordatorio en curso',
      '❓ *.ayuda* - Mostrar esta ayuda',
      '',
      '💡 *Formatos de fecha:*',
      '• hoy, mañana, en 3 días',
      '• DD/MM/AAAA (ej: 25/12/2024)',
      '',
      '⏰ *Formato de hora:* HH:MM (ej: 14:30)',
      '',
      '⚠️ *Importante:* No uses comandos (.) como respuestas'
    ]);
  });

// FUNCIÓN CRON MEJORADA
const iniciarCronRecordatorios = (adapterProvider) => {
    console.log('🕒 Iniciando cron job de recordatorios...');

    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const recordatorios = leerRecordatorios();
            let hayActualizaciones = false;

            console.log(`📋 Revisando ${recordatorios.length} recordatorios a las ${ahora.toLocaleTimeString()}`);

            // Verificar que el proveedor esté disponible
            const bot = adapterProvider.getInstance();
            if (!bot) {
                console.error('❌ Bot no disponible en cron job');
                return;
            }

            for (const recordatorio of recordatorios) {
                if (recordatorio.enviado) continue;

                try {
                    const [dia, mes, anio] = recordatorio.fecha.split('/');
                    const [hora, minuto] = recordatorio.hora.split(':');
                    const fechaRecordatorio = new Date(anio, mes - 1, dia, hora, minuto);

                    // Agregar margen de 1 minuto para evitar problemas de sincronización
                    const diferencia = ahora.getTime() - fechaRecordatorio.getTime();
                    
                    if (diferencia >= 0 && diferencia < 60000) { // Entre 0 y 60 segundos
                        console.log(`📤 Enviando recordatorio: ${recordatorio.titulo} a ${recordatorio.chatId}`);

                        const mensaje = [
                            `🔔 *¡RECORDATORIO!*`,
                            ``,
                            `📌 *${recordatorio.titulo}*`,
                            `✏️ ${recordatorio.descripcion}`,
                            ``,
                            `📅 Programado para: ${recordatorio.fecha} a las ${recordatorio.hora}`
                        ].join('\n');

                        await bot.sendText(recordatorio.chatId, mensaje);

                        recordatorio.enviado = true;
                        recordatorio.fechaEnvio = ahora.toISOString();
                        hayActualizaciones = true;

                        console.log(`✅ Recordatorio enviado exitosamente: ${recordatorio.titulo}`);
                    }
                } catch (errorRecordatorio) {
                    console.error('❌ Error procesando recordatorio:', recordatorio.id, errorRecordatorio);
                }
            }

            if (hayActualizaciones) {
                actualizarRecordatorios(recordatorios);
                console.log('💾 Archivo de recordatorios actualizado');
            }
        } catch (error) {
            console.error('❌ Error general en cron job:', error);
        }
    });

    console.log('✅ Cron job iniciado - Revisión cada minuto');
};

// Limpiar procesos colgados cada 30 minutos
setInterval(() => {
    const ahora = Date.now();
    for (const [userId, proceso] of procesosEnCurso.entries()) {
        // Limpiar procesos de más de 30 minutos
        if (ahora - proceso.iniciado > 30 * 60 * 1000) {
            procesosEnCurso.delete(userId);
            console.log(`🧹 Proceso limpiado para usuario ${userId} (timeout)`);
        }
    }
}, 30 * 60 * 1000);

// FUNCIÓN MAIN
const main = async () => {
    try {
        // Verificar permisos al inicio
        console.log('🔍 Verificando permisos de directorios...');
        try {
            fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
            console.log('✅ Permisos de lectura/escritura verificados para', DATA_DIR);
        } catch (error) {
            console.error('❌ Sin permisos de lectura/escritura en', DATA_DIR);
            console.error('Error:', error.message);
        }

        const adapterFlow = createFlow([
            recordatorioFlow,
            cancelarFlow,
            verRecordatoriosFlow,
            ayudaFlow
        ])
        
        const adapterProvider = createProvider(Provider)
        const adapterDB = new Database()

        const { handleCtx, httpServer } = await createBot({
            flow: adapterFlow,
            provider: adapterProvider,
            database: adapterDB,
        })

        // Iniciar el cron job después de crear el bot
        iniciarCronRecordatorios(adapterProvider);

        // API Endpoints
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
        console.log(`📱 Comandos disponibles: .r, .ver, .cancelar, .ayuda`);
        console.log(`📁 Directorio de datos: ${DATA_DIR}`);
        console.log(`📄 Archivo de recordatorios: ${RECORDATORIOS_FILE}`);
        
    } catch (error) {
        console.error('❌ Error crítico iniciando el bot:', error);
        process.exit(1);
    }
}

main()

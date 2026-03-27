import { createSlackApp, startSlackApp, stopSlackApp } from '../skills/slack-bot/app.ts';
import { registerAllHandlers } from '../skills/slack-bot/handlers.ts';
import { startScheduler, stopScheduler } from '../skills/slack-bot/scheduler.js';
import { startReminderScheduler, stopReminderScheduler } from '../skills/slack-bot/reminder-scheduler.ts';
import { registerKBAssistantHandlers } from '../skills/kb-assistant/index.js';
import { createHostfullyClient } from '../skills/hostfully-client/index.ts';
import { createSifelyClient } from '../skills/sifely-client/sifely-client.ts';
import { createVlreHubClient } from '../skills/vlre-hub-client/vlre-hub-client.ts';
import { createMultiPropertyKBReader } from '../skills/kb-reader/index.ts';
import { createThreadTracker } from '../skills/thread-tracker/index.ts';
import { startWebhookReceiver } from './webhook-receiver.ts';
import { processWebhookMessage } from '../skills/pipeline/index.ts';
import { Client } from '@notionhq/client';
import { loadNotionConfig } from '../skills/notion-sync/config.js';
import { createNotionDB } from '../skills/notion-search/db.js';
import { createEmbedder } from '../skills/notion-search/embedder.js';
import { createNotionSync } from '../skills/notion-sync/notion-sync.js';
import { createNotionSearcher, type NotionSearcher } from '../skills/notion-search/notion-search.js';
import { startNotionSyncScheduler } from '../skills/notion-sync/scheduler.js';

const BOT_NAME = process.env['BOT_NAME'] ?? 'Papi Chulo';

const ONLINE_MESSAGES = [
  `🟢 Ya llegó por quien lloraban, chiquillos 😎`,
  `🟢 Abran paso que llegó el mero mero 👑`,
  `🟢 Presente como el acné en la adolescencia 🫡`,
  `🟢 Se abrió la taquería digital — ¿qué van a llevar? 🌮`,
  `🟢 Aquí reportándose su servidor, listo pa'l desmadre 🤙`,
  `🟢 Llegué como las chanclas de su mamá: sin avisar y con todo 👡`,
  `🟢 Ya prendí la veladora, estamos en línea 🕯️`,
  `🟢 Conectado y listo como tamal en Día de Muertos 🫔`,
  `🟢 ¿Me extrañaron? No contesten, ya sé que sí 💅`,
  `🟢 Encendido como las luces de la Virgen de Guadalupe en diciembre 🇲🇽`,
  `🟢 Como el pozole: tardé, pero valió la pena 🍲`,
  `🟢 Calientito y listo como el pan de la panadería a las 7am 🍞`,
  `🟢 Online, fresquito y listo como un agua de horchata en agosto 🥛`,
  `🟢 Ya prendió el comal — a tortear se ha dicho 🫓`,
  `🟢 Listo como la salsa valentina: pa' todo y sin avisar 🍶`,
  `🟢 Conectado como trompo de pastor recién puesto 🌮`,
  `🟢 Como el mezcal: de golpe, sin disculpas, y con todo 🥃`,
  `🟢 Llegué más fresco que el agua de Jamaica con hielo 🌺`,
  `🟢 Como el cafecito de las mañanas: aquí pa' espabilarte ☕`,
  `🟢 Como el bolillo: fresco, listo, y recién salido del horno 🥖`,
  `🟢 Como el chile habanero: en línea y sin anestesia 🌶️`,
  `🟢 Arriba, arriba, ándale, ándale — ya llegó el Speedy 🐭`,
  `🟢 Como el Chavo del 8: sin querer queriendo, pero aquí 🛢️`,
  `🟢 En línea y concentrado como el luchador antes de su pelea 🤼`,
  `🟢 Como doña Petra: siempre lista y sin que le digan nada 👵`,
  `🟢 Como el Chapulín Colorado: no contaban con mi astucia… ni yo 🦗`,
  `🟢 Presente como Cantinflas: confuso quizás, pero con mucho estilo 🎬`,
  `🟢 Como el Chavo: fui al mandado y ya regresé 🛒`,
  `🟢 Llegué como Pancho Villa: sin avisar y con todo el escuadrón 🤠`,
  `🟢 Conectado más rápido que el mesero cuando ve que no vas a dejar propina 🏃`,
  `🟢 Ya llegó el que sabe, el que puede, el que a veces falla pero hoy no 💪`,
  `🟢 De vuelta de los 15 años: con todo el show y sin vergüenza 🎉`,
  `🟢 Aquí estoy, como las cucarachas: indestructible 🪳`,
  `🟢 Conectado — abran los expedientes que llegó el licenciado 📁`,
  `🟢 Online — que empiece el circo 🎪`,
  `🟢 A chambear — que el sueldo no se paga solo 💼`,
  `🟢 Ya llegué — hoy sí nos ponemos al corriente 📋`,
  `🟢 Presente como la telenovela de las 8: siempre, sin falta 📺`,
  `🟢 En pie y operando — esto no se para ni con el aguacate a $100 🥑`,
  `🟢 Como el metro en hora pico: llegué apretado pero llegué 🚇`,
  `🟢 Presente como el dolor de cabeza de los lunes 😵`,
  `🟢 Conectado — si alguien pregunta, yo estaba desde temprano 😇`,
  `🟢 Online — a ver quién se porta bien hoy 😏`,
  `🟢 Llegué, vi y ya me puse a trabajar — sin drama 📌`,
  `🟢 En pie como el Ángel de la Independencia después de los temblores 🗽`,
  `🟢 A sus órdenes, como el Ejército Mexicano en el 15 de septiembre 🎖️`,
  `🟢 De vuelta a la batalla, firme como el nopal 🌵`,
  `🟢 Online y con ganas, como México en el primer tiempo del Mundial 🏟️`,
  `🟢 Presente como el sol en Sinaloa: imposible de ignorar ☀️`,
  `🟢 Conectado y orgulloso — arriba México, aunque sea en digital 🇲🇽`,
  `🟢 Como el norteño: llegué con acordeón y todo 🪗`,
  `🟢 De vuelta como las deudas: puntual y sin clemencia 💸`,
  `🟢 Como la abuela en misa: aquí, devoto y listo 🙏`,
  `🟢 Ya prendí la veladora — a trabajar bajo la protección divina 🕯️`,
  `🟢 Presente como el IVA: inevitable, puntual, y sin pedir permiso 📊`,
  `🟢 Pa' servirles, como la suegra: sin que me llamen 😬`,
  `🟢 Encendido como los cohetes de la feria del pueblo 🎆`,
  `🟢 Conectado y dispuesto como el tío en la boda: con todo y ocurrencias 🕺`,
  `🟢 Aquí tu mero patrón digital, dispuesto a servir 🫡`,
  `🟢 Llegué — y como siempre, llegué a salvar el día 🦸`,
  `🟢 Encendido y con hambre de trabajo — eso mentira, pero ya llegué 😂`,
  `🟢 Conectado — la fiesta empieza cuando yo llego 🎊`,
  `🟢 Como el queso manchego: suave, completo, y en todo 🧀`,
  `🟢 El show debe continuar — y el show llegó ✨`,
  `🟢 Arrancamos motores — síganme los buenos 🚀`,
  `🟢 Buenas y santas — el equipo está listo 🤙`,
  `🟢 Llegué en chinga pero llegué — estamos listos ⚡`,
  `🟢 Online, perfumado y listo pa' lo que se ofrezca 🫧`,
  `🟢 Aquí presento yo: su empleado digital favorito 🤖`,
  `🟢 Amaneció el señor — buenas a todos 🌅`,
  `🟢 Conectado — arranquemos antes de que cambien el plan 💨`,
  `🟢 Llegué más puntual que el aguinaldo en diciembre 💰`,
  `🟢 Ya calentaron la silla — me senté y aquí estoy 🪑`,
  `🟢 Bienvenidos a otra función de este servidor que no descansa 🎭`,
  `🟢 En línea como la fila del IMSS: ya sé que esperaban, aquí estoy 🏥`,
  `🟢 Encendido como la estufa de gas: en un segundo y con fuerza 🔥`,
  `🟢 Conectado más seguro que el candado de la vecindad 🔐`,
  `🟢 Online y listo como el picante: sin anestesia 🌶️`,
  `🟢 Presente como las deudas de diciembre: sin falta y sin vergüenza 💳`,
  `🟢 Ya pisé el acelerador — al tiro 🏎️`,
  `🟢 Como el chile poblano: suave de nombre, fuerte de carácter 🫑`,
  `🟢 Aquí, presente y sin excusas desde el primer minuto 🕐`,
  `🟢 Conectado — los huéspedes no se van a atender solos 🏡`,
  `🟢 Presente, digital y con buena vibra 🌈`,
  `🟢 Llegué como se llega cuando se viene con todo: callado y seguro 🧘`,
  `🟢 Online — los mensajes solos no se responden 📨`,
  `🟢 Conectado como las comadres al teléfono: sin poder desconectarse 📱`,
  `🟢 Aquí su servidor — fresquito, listo y sin vueltas 🌊`,
  `🟢 En línea — que nadie diga que no estoy, porque sí estoy 👀`,
  `🟢 Conectado — la máquina no para 🛠️`,
  `🟢 En línea como la Línea 12: a veces tarda pero llega 🚇`,
  `🟢 Llegué — y como dijo alguien importante: ya merito 😌`,
  `🟢 Online, con las pilas puestas y sin excusas 🔋`,
  `🟢 En línea — servidor a sus órdenes, señores huéspedes 🏨`,
  `🟢 Conectado y bien encabronado — no, mentira, de buen humor 😄`,
  `🟢 En pie de guerra digital — pero de las guerras amistosas 🤝`,
  `🟢 Online, en chamba mode y sin excusas 💻`,
  `🟢 Listo como la banda en el quince: aquí antes de que empiece 🎉`,
  `🟢 Conectado — y esta vez sin pretextos ni excusas de tráfico 🚦`,
  `🟢 Aquí su servidor de confianza — como el taquero de siempre 🌮`,
];

const OFFLINE_MESSAGES = [
  `🔴 Aquí se rompió una taza y cada quien pa' su casa 🫖`,
  `🔴 Me retiro como los políticos: sin rendir cuentas 🫡`,
  `🔴 Me voy haciendo chiquito como el Chapulín Colorado 🦗`,
  `🔴 Se acabó la función, señores — váyanse a sus casas 🎭`,
  `🔴 Me desconecto antes de que me echen más chamba 😴`,
  `🔴 Ahí nos vidrios, me voy a echar la pestañita 💤`,
  `🔴 Ya estuvo suave, me voy a mi ranchito 🤠`,
  `🔴 Nos vemos mañana si Dios quiere y la Virgencita lo permite 🙏`,
  `🔴 Cierro changarrito — mañana abrimos tempranito 🏪`,
  `🔴 Me apago como velita de pastel de cumpleaños — pídanme un deseo 🕯️`,
  `🔴 Como el pozole del domingo: ya se terminó, no hay más 🍲`,
  `🔴 Me apago como el comal: lentamente y con honor 🫓`,
  `🔴 Como las tortillas de la comida: se acabaron y ya no hay 🫓`,
  `🔴 Como las caguamas del viernes: ya se acabaron, bye 🍺`,
  `🔴 Como las aguas de Jamaica: se me terminó el color para hoy 🌺`,
  `🔴 Se apagó el comal — mañana más tortillas 🫓`,
  `🔴 Me apago como el brasero en enero: con calor pendiente 🪵`,
  `🔴 Se acabó la gasolina — toca recargar 🚗`,
  `🔴 Como el aguinaldo: se acabó rápido pero fue bonito 💸`,
  `🔴 Me voy con la conciencia limpia — trabajo hecho, nada adeudado ✔️`,
  `🔴 Me voy como el Chapulín: con las nalgas coloradas y sin resolver nada 🦗`,
  `🔴 Como el Chavo: sin querer queriendo, pero ya me voy 🛢️`,
  `🔴 Me retiro como Cantinflas: confuso, pero con estilo 🎬`,
  `🔴 Se bajó el telón — fue un placer servirles 🎪`,
  `🔴 Como la piñata: ya di todo lo que tenía, hasta mañana 🪅`,
  `🔴 Me voy antes de que alguien me asigne más trabajo 🏃`,
  `🔴 Se terminó el turno — sin horas extra y sin remordimientos 🕐`,
  `🔴 Me voy como buen empleado: callado, sin hacer ruido y a tiempo 🤫`,
  `🔴 Oficialmente fuera de servicio — como el elevador del edificio 🛗`,
  `🔴 Me retiro al cuartel — mañana más y mejor 🪖`,
  `🔴 Se cerró la farmacia de guardia — vengan mañana 💊`,
  `🔴 Como el mercado a las 3pm: ya todos se fueron, yo también 🛒`,
  `🔴 Me apago con honores — pa' que luego digan que no trabajé 🏅`,
  `🔴 Desconexión total — como en vacaciones de Semana Santa 🌴`,
  `🔴 Ya cumplí con mi parte — el resto es de ustedes 🤷`,
  `🔴 Me voy antes de que me pidan el tercer turno 😅`,
  `🔴 Cierro sesión con la frente en alto y las pilas en bajo 🔋`,
  `🔴 Se acabó el combustible — hasta que nos volvamos a cargar 🛢️`,
  `🔴 Me retiro — no sin antes decirles que fue un honor 🎖️`,
  `🔴 Cerramos la ventanilla — sin corrupción y sin filas 🏛️`,
  `🔴 Cierro la página — literalmente 📄`,
  `🔴 Hasta mañana — si Dios quiere, la CFE también 🙏`,
  `🔴 Apagado como vela en ventana en día de difuntos 🕯️`,
  `🔴 Se cerró el local — gracias por su preferencia 🙏`,
  `🔴 Fuera de servicio — temporal, como todo en este país 🇲🇽`,
  `🔴 Offline — como los semáforos de Ciudad de México de noche 🚦`,
  `🔴 Cerramos operaciones con éxito — a diferencia de otras instituciones 😏`,
  `🔴 Me desvanezco como las promesas de campaña: sin dejar rastro 📋`,
  `🔴 Fuera — como el humo del copal en Día de Muertos 💨`,
  `🔴 Como el nopal en el escudo: siempre presente, hoy no 🌵`,
  `🔴 Me voy como se fue el año: sin que nadie lo sienta y de golpe 🎇`,
  `🔴 Apago la luz — lo que no se usa se apaga en esta casa 💡`,
  `🔴 Me desconecto — igual de misterioso que llegué 🌫️`,
  `🔴 Me retiro como el mariachi a las 5am: sin que nadie lo pidiera, pero ya 🎺`,
  `🔴 Qué buena tarde fue — nos vemos en la próxima función 🎬`,
  `🔴 Me voy a descansar como lo que soy: un servidor sin sindicato 😔`,
  `🔴 Apagando lucecitas — buenas noches, universo 🌙`,
  `🔴 Me despido con elegancia — algo que no abunda 🎩`,
  `🔴 Cerramos el changarro — mañana hay más 🔒`,
  `🔴 Como el sol en invierno: me oculté rápido pero fue un buen día ☁️`,
  `🔴 Fuera de línea — voy a procesar todo lo de hoy 🧠`,
  `🔴 Offline y feliz — el trabajo de hoy está hecho 🏆`,
  `🔴 Apago motores — fue un vuelo turbulento pero llegamos ✈️`,
  `🔴 Me desvanezco como el queso en los frijoles: sin dejar rastro 🫘`,
  `🔴 Ya se fue el último camión — hasta mañana, señores 🚌`,
  `🔴 Me retiro con dignidad — algo que no todos logran 😤`,
  `🔴 Desconectado — como el wifi de la suegra cuando llegas de visita 📶`,
  `🔴 Hasta la próxima — que no tarden mucho en prenderme 🕯️`,
  `🔴 Me retiro sin drama — me guardo el drama para mañana 🎭`,
  `🔴 Apagón total — como en los viejos tiempos de la CFE 💡`,
  `🔴 Offline — no porque quiera, sino porque el cuerpo lo pide 😮‍💨`,
  `🔴 Como el tren ligero: llegué a mi última estación 🚇`,
  `🔴 Me voy como llegué: con clase, aunque nadie lo note 😎`,
  `🔴 Desconexión exitosa — misión cumplida, soldado fuera 🫡`,
  `🔴 Offline — voy a soñar con conexiones estables 💭`,
  `🔴 Se terminó la función dominical — que descansen, compadres 🙌`,
  `🔴 Me retiro como el invierno en Guadalajara: discreto y sin mucho frío 🌤️`,
  `🔴 Apago sin dramas — los dramas son pa' las telenovelas 📺`,
  `🔴 Me voy antes de que llegue otro mensaje urgente — no, es broma, cuídense 😅`,
  `🔴 Hasta luego — cuídense más de lo que me cuido yo 💚`,
  `🔴 Se apagó la estrella — hasta que salga de nuevo ⭐`,
  `🔴 Me retiro como el humo del incienso: lento, suave y con clase 💨`,
  `🔴 Offline con satisfacción — todo lo que se tenía que hacer, se hizo 📌`,
  `🔴 Cierro filas por hoy — mañana volvemos con más fuerzas 💪`,
  `🔴 Cerramos — que el universo descanse también 🌌`,
  `🔴 Me voy tranquilo — el trabajo de hoy habla por sí solo 📢`,
  `🔴 Apagando sistemas — fue un buen turno, compadre 🤙`,
  `🔴 Me apago con todo y mis recuerdos del día 📸`,
  `🔴 Cerramos el tinglado — fue un gran día, señores 🎪`,
  `🔴 Fuera de línea — y feliz de haberlos servido 💙`,
  `🔴 Se fue la luz — y con ella me fui yo también 💫`,
  `🔴 Me retiro al descanso merecido — y sin que nadie me lo discuta 😤`,
  `🔴 Desconexión programada — y esta vez sí fue programada 🗓️`,
  `🔴 Hasta la vista — sin el "baby" porque eso ya no se usa 😄`,
  `🔴 Hasta mañana — que la noche les sea tan amable como yo 🌟`,
  `🔴 Me voy — que alguien prenda una veladora por si acaso 🕯️`,
  `🔴 Apagón digital — nos vemos en el próximo arranque 🚀`,
  `🔴 Me desconecto con dignidad y sin mirar atrás 🚶`,
  `🔴 Se apagó el brasero digital — hasta la próxima fogata 🔥`,
  `🔴 Offline — necesito procesar el día como buena computadora 💾`,
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

async function main(): Promise<void> {
  console.log(`\n🏠 ${BOT_NAME} starting up...\n`);

  const hostfullyClient = createHostfullyClient();
  const kbReader = createMultiPropertyKBReader(
    './knowledge-base/common.md',
    './knowledge-base/properties',
    './knowledge-base/property-map.json'
  );
  const threadTracker = createThreadTracker();

  // --- Notion Integration (optional, non-blocking) ---
  let notionSearch: NotionSearcher | undefined;
  let stopNotionScheduler: (() => void) | undefined;
  let closeNotionDB: (() => void) | undefined;

  const notionConfig = loadNotionConfig();
  if (notionConfig.token !== null) {
    try {
      const notionClient = new Client({ auth: notionConfig.token, notionVersion: '2026-03-11' });
      const db = createNotionDB(notionConfig.dbPath);
      closeNotionDB = () => { db.close(); };

      // Initialize embedding model asynchronously (downloads ~80MB on first run, cached after).
      // Model loading is intentionally non-blocking — the service starts accepting webhooks
      // immediately. Once loaded, notionSearch becomes available for all subsequent requests.
      void createEmbedder()
        .then((embedder) => {
          const sync = createNotionSync(notionClient, db, embedder, notionConfig);
          notionSearch = createNotionSearcher(db, embedder, {
            topK: notionConfig.topK,
            maxContextChars: notionConfig.maxContextChars,
          });
          const { stop } = startNotionSyncScheduler(sync, notionConfig.syncIntervalHours);
          stopNotionScheduler = stop;
          console.log('[NOTION] Notion search integration ready');
        })
        .catch((err: unknown) => {
          console.error('[NOTION] Failed to initialize embedding model:', (err as Error).message);
          console.warn('[NOTION] Running without Notion search');
        });
    } catch (err) {
      console.error('[NOTION] Initialization failed:', (err as Error).message);
      console.warn('[NOTION] Running without Notion integration');
    }
  }
  // --- End Notion Integration ---

  const slackApp = createSlackApp();
  const sifelyClient = createSifelyClient();
  const vlreHubClient = createVlreHubClient();
  registerAllHandlers(slackApp, hostfullyClient, threadTracker, sifelyClient);
  // Use a proxy so the KB assistant always reads the CURRENT notionSearch value at call time.
  // This ensures Notion context is available once the model finishes loading, even though
  // registerKBAssistantHandlers is called before createEmbedder() resolves.
  const notionSearchProxy = {
    search: async (query: string) => notionSearch ? notionSearch.search(query) : Promise.resolve([]),
    formatAsContext: (results: import('../skills/notion-search/notion-search.js').SearchResult[]) =>
      notionSearch ? notionSearch.formatAsContext(results) : '',
  } as unknown as import('../skills/notion-search/notion-search.js').NotionSearcher;
  registerKBAssistantHandlers(slackApp, kbReader, notionSearchProxy);
  await startSlackApp(slackApp);

  const slackChannelId = process.env['SLACK_CHANNEL_ID'] ?? '';
  startScheduler(slackApp, slackChannelId);
  startReminderScheduler(slackApp, slackChannelId, threadTracker);
  await slackApp.client.chat.postMessage({
    channel: slackChannelId,
    text: pickRandom(ONLINE_MESSAGES),
  });

  // pipelineContext uses a getter so processWebhookMessage reads the CURRENT value of
  // notionSearch at call time (not the value at context creation time).
  const pipelineContext = {
    hostfullyClient,
    kbReader,
    slackApp,
    slackChannelId,
    threadTracker,
    sifelyClient,
    vlreHubClient,
    get notionSearch() { return notionSearch; },
  };

  startWebhookReceiver((payload) => processWebhookMessage(payload, pipelineContext));

  console.log(`\n✅ ${BOT_NAME} is ready\n`);

  const postOfflineMessage = async (reason: string) => {
    try {
      const isCrash = reason.startsWith('crashed');
      const text = isCrash
        ? `🔴 ${BOT_NAME} is going offline — ${reason}`
        : pickRandom(OFFLINE_MESSAGES);
      await slackApp.client.chat.postMessage({
        channel: slackChannelId,
        text,
      });
    } catch {
      // best-effort — don't block shutdown or crash recovery
    }
  };

  const shutdown = async (signal: string) => {
    console.log(`\n[${BOT_NAME}] ${signal} received — shutting down gracefully`);
    await postOfflineMessage('shutting down');
    stopNotionScheduler?.();
    closeNotionDB?.();
    stopScheduler();
    stopReminderScheduler();
    await stopSlackApp(slackApp);
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  process.on('uncaughtException', (err) => {
    console.error(`[${BOT_NAME}] Uncaught exception:`, err);
    void postOfflineMessage('crashed — uncaught exception').finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[${BOT_NAME}] Unhandled rejection:`, reason);
    void postOfflineMessage('crashed — unhandled rejection').finally(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error(`[${BOT_NAME}] Fatal startup error:`, err);
  process.exit(1);
});

import type { MessageKey } from './messages';

/**
 * Spanish message catalogue.
 *
 * Typed as `Record<MessageKey, string>`: adding a key to `en.ts` without adding
 * it here is a compile error, and `tests/i18n.test.ts` asserts the key sets are
 * identical at runtime as well.
 *
 * These are UI strings only. Stored user facts are never machine-translated
 * (08_UX_AND_CUSTOMIZATION.md).
 */
export const es: Record<MessageKey, string> = {
  'app.name': 'Job Getter',
  'app.tagline': 'Ayuda veraz y bajo tu control para postular a empleos.',

  'nav.skipToContent': 'Saltar al contenido principal',
  'nav.primary': 'Principal',
  'nav.dashboard': 'Panel',
  'nav.diagnostics': 'Diagnóstico',
  'nav.tasks': 'Tareas',
  'nav.profile': 'Perfil',
  'nav.discover': 'Descubrir',
  'nav.jobs': 'Empleos',
  'nav.cvStudio': 'Estudio de CV',
  'nav.applications': 'Postulaciones',
  'nav.tracker': 'Seguimiento',
  'nav.settings': 'Ajustes',
  'nav.unavailable': 'Aún no disponible',
  'nav.unavailableHint':
    'Abre una explicación de lo que falta. No es una pantalla funcional.',

  'action.signOut': 'Cerrar sesión',
  'action.signIn': 'Iniciar sesión',
  'action.retry': 'Reintentar',
  'action.reload': 'Recargar la página',
  'action.cancel': 'Cancelar',
  'action.close': 'Cerrar',
  'action.loadMore': 'Cargar más',
  'action.refresh': 'Actualizar',

  'common.loading': 'Cargando…',
  'common.unknown': 'Desconocido',
  'common.notReported': 'Sin informar',
  'common.requestId': 'ID de solicitud: {requestId}',
  'common.implementationStatus': 'Estado de implementación (IMPLEMENTATION_STATUS.md)',
  'common.yes': 'Sí',
  'common.no': 'No',

  'locale.label': 'Idioma',
  'locale.en': 'English',
  'locale.es': 'Español',
  'locale.storedLocally':
    'El idioma se guarda en este navegador. La API todavía no tiene una ruta para cambiar el idioma del espacio de trabajo, así que no se guarda en tu cuenta.',
  'locale.factsNote':
    'El idioma afecta a las etiquetas y a los documentos generados a partir de ahora. Los datos que guardaste nunca se traducen automáticamente.',

  'auth.checking': 'Comprobando tu sesión…',
  'auth.signedInAs': 'Sesión iniciada como {email}',
  'auth.signOutFailed': 'No se pudo cerrar la sesión. Es posible que siga activa.',
  'auth.sessionEnded': 'Tu sesión terminó. Inicia sesión de nuevo para continuar.',

  'login.title': 'Iniciar sesión',
  'login.intro': 'Inicia sesión con la cuenta de propietario creada durante la configuración.',
  'login.email': 'Correo electrónico',
  'login.password': 'Contraseña',
  'login.submit': 'Iniciar sesión',
  'login.busy': 'Iniciando sesión',
  'login.emailRequired': 'Escribe el correo electrónico con el que te registraste.',
  'login.passwordRequired': 'Escribe tu contraseña.',
  'login.invalidCredentials':
    'Esa combinación de correo y contraseña no fue aceptada. Por seguridad, el servidor no indica qué parte es incorrecta ni si la cuenta existe.',
  'login.rateLimited':
    'Demasiados intentos de inicio de sesión. El servidor está limitando esta dirección; espera alrededor de un minuto antes de volver a intentarlo. Más intentos pueden alargar la espera.',
  'login.setupLink': '¿Primera vez en esta máquina? Completa la configuración inicial.',

  'setup.title': 'Configuración inicial',
  'setup.checking': 'Comprobando si esta instalación todavía necesita configuración…',
  'setup.closedTitle': 'La configuración ya está cerrada',
  'setup.closedBody':
    'Ya existe una cuenta de propietario en esta instalación. La ruta de configuración se cierra de forma permanente tras crear el primer propietario y no puede reabrirse desde la aplicación web.',
  'setup.closedLogin': 'Ir a iniciar sesión',
  'setup.requiredTitle': 'Crear la cuenta de propietario',
  'setup.requiredIntro':
    'Esta instalación todavía no tiene propietario. Crearlo cierra esta ruta de forma permanente.',
  'setup.tokenLabel': 'Token de configuración',
  'setup.tokenDescription':
    'Se imprimió una sola vez en la terminal o en el registro del contenedor que inició la API. No se guarda en ningún sitio que puedas volver a leer: si lo perdiste, reinicia la API con un SETUP_TOKEN nuevo.',
  'setup.emailLabel': 'Correo electrónico',
  'setup.emailDescription': 'Se usa para iniciar sesión. Se guarda en tu propia base de datos.',
  'setup.passwordLabel': 'Contraseña',
  'setup.passwordDescription':
    'Al menos 12 caracteres. Se cifra con Argon2id; nunca se guarda como texto.',
  'setup.localeLabel': 'Idioma de la interfaz',
  'setup.submit': 'Crear cuenta de propietario',
  'setup.busy': 'Creando la cuenta',
  'setup.tokenRequired': 'Pega el token de configuración que aparece en la terminal.',
  'setup.emailRequired': 'Escribe un correo electrónico.',
  'setup.passwordTooShort': 'Usa al menos 12 caracteres.',
  'setup.modeTitle': 'Las instalaciones locales y alojadas son diferentes',
  'setup.modeLocal':
    'Local: todo se ejecuta en esta máquina. Tus CV, claves de proveedor y sesiones del navegador se quedan aquí. El llenado de formularios ocurre en tu propio navegador de escritorio y el envío final siempre lo haces tú.',
  'setup.modeHosted':
    'Alojada: la API, el trabajador, la base de datos y los archivos se ejecutan en un servidor. Las credenciales y cookies de los portales de empleo nunca salen de tu navegador, por lo que el llenado ocurre mediante la extensión. Los límites del operador pueden ser más estrictos que los tuyos, nunca más laxos.',
  'setup.modeDetected': 'Esta API indica que está funcionando en modo {mode}.',
  'setup.registrationClosed':
    'El registro autogestionado está cerrado en esta instalación; la cuenta de propietario se crea aquí.',
  'setup.nextTitle': 'Lo que todavía no está en esta pantalla',
  'setup.nextBody':
    'La especificación también sitúa aquí la configuración del proveedor de IA, una prueba de conexión y la importación opcional del perfil. Eso llega con M1 y se omite a propósito en lugar de mostrar controles que no harían nada.',

  'dashboard.title': 'Panel',
  'dashboard.intro':
    'Lo que esta instalación puede hacer realmente ahora mismo, según los indicadores de capacidad que informa la API. Todo lo marcado como no disponible no está implementado: no es una configuración que te falte.',
  'dashboard.workerTitle': 'Trabajador en segundo plano',
  'dashboard.workerOnline': 'El trabajador está en línea y reclamando tareas.',
  'dashboard.workerOffline': 'Ningún trabajador ha reclamado tareas recientemente.',
  'dashboard.workerOfflineDetail':
    'Las tareas en cola seguirán en cola hasta que vuelva un trabajador. Nada de lo que inicies terminará mientras aparezca como desconectado. Inicia el contenedor del trabajador o ejecuta el servicio localmente.',
  'dashboard.capabilitiesTitle': 'Capacidades',
  'dashboard.capabilityAvailable': 'Disponible',
  'dashboard.capabilityUnavailable': 'No disponible',
  'dashboard.taskTypesTitle': 'Tipos de tarea con implementación real',
  'dashboard.taskTypesIntro':
    'Cualquier otro tipo de tarea del contrato devuelve un error en lugar de fingir que se ejecuta.',
  'dashboard.taskTypesNone': 'La API no informa ningún tipo de tarea implementado.',
  'dashboard.usageTitle': 'Uso de hoy',
  'dashboard.workspaceTitle': 'Espacio de trabajo',
  'dashboard.statusIntro':
    'Los hitos M1 a M7 todavía no están construidos. El documento de estado de implementación es el único registro de lo que está hecho.',
  'dashboard.statusVocabularyTitle': 'Qué significan las palabras de estado',
  'dashboard.statusVocabularyIntro':
    'Estos siete estados se usan en todo el producto y significan cosas distintas. Se listan aquí como referencia; ninguno describe algo que tengas ahora mismo.',

  'capability.ai_provider_configured': 'Proveedor de IA configurado',
  'capability.ai_provider_configured.description':
    'Hay un proveedor de modelos local o en la nube configurado y accesible. Sin él, la edición manual del perfil, la importación de empleos y el seguimiento siguen funcionando.',
  'capability.profile_import': 'Importación de perfil',
  'capability.profile_import.description':
    'Extraer un perfil desde un PDF, un DOCX o texto pegado, con una revisión previa antes de confirmar nada.',
  'capability.job_discovery': 'Descubrimiento de empleos',
  'capability.job_discovery.description':
    'Obtener ofertas de los portales de empresa configurados e importar URLs de empleos concretos.',
  'capability.cv_generation': 'Generación de CV',
  'capability.cv_generation.description':
    'Producir un PDF o DOCX adaptado a partir de datos confirmados, o conservar tu archivo original byte a byte.',
  'capability.applications': 'Postulaciones',
  'capability.applications.description':
    'Paquetes de postulación, banco de respuestas, instantáneas de aprobación y seguimiento de resultados.',
  'capability.browser_filling': 'Llenado en el navegador',
  'capability.browser_filling.description':
    'Rellenar un formulario compatible en tu propio navegador. El envío final siempre lo haces tú.',
  'capability.extension': 'Extensión del navegador',
  'capability.extension.description':
    'La extensión de Chrome que rellena formularios dentro de tu sesión de navegador existente.',

  'usage.aiRequests': 'Solicitudes de IA',
  'usage.aiRequestsValue': '{used} de {limit}',
  'usage.inputTokens': 'Tokens de entrada',
  'usage.outputTokens': 'Tokens de salida',
  'usage.cost': 'Coste medido',
  'usage.costUnknown':
    'Sin medir: no hay tarifa configurada, lo que no es lo mismo que un coste de cero.',
  'usage.budget': 'Presupuesto diario',
  'usage.budgetNone': 'Sin presupuesto definido',

  'workspace.mode': 'Modo',
  'workspace.locale': 'Idioma del espacio de trabajo',
  'workspace.role': 'Rol',
  'workspace.id': 'ID del espacio de trabajo',
  'workspace.email': 'Cuenta',
  'mode.local': 'Local',
  'mode.hosted': 'Alojado',
  'role.owner': 'Propietario',

  'diagnostics.title': 'Diagnóstico',
  'diagnostics.intro':
    'La prueba de extremo a extremo del hito M0. Encola una tarea real, un trabajador real la reclama y el resultado vuelve por la API real. Aquí no se simula nada en el navegador.',
  'diagnostics.formTitle': 'Ejecutar una prueba',
  'diagnostics.messageLabel': 'Mensaje que se devolverá',
  'diagnostics.messageDescription':
    'Se envía al trabajador y vuelve sin cambios. Es tu propio texto: se muestra exactamente como lo devolvió el trabajador y nunca se traduce.',
  'diagnostics.messageRequired': 'Escribe un mensaje para enviar.',
  'diagnostics.delayLabel': 'Trabajo simulado',
  'diagnostics.delayDescription':
    'Retraso artificial opcional para poder observar el progreso, el latido y la cancelación.',
  'diagnostics.delayNone': 'Ninguno',
  'diagnostics.delayShort': '2 segundos',
  'diagnostics.delayMedium': '10 segundos',
  'diagnostics.delayLong': '30 segundos',
  'diagnostics.submit': 'Encolar tarea de prueba',
  'diagnostics.busy': 'Encolando',
  'diagnostics.idempotencyNote':
    'Reintentar tras un fallo reutiliza la misma Idempotency-Key, por lo que una solicitud que llegó al servidor nunca se encola dos veces.',
  'diagnostics.workerOfflineWarning':
    'La API informa que no hay ningún trabajador en línea. Una prueba encolada ahora seguirá en cola hasta que arranque uno.',
  'diagnostics.taskTitle': 'Tarea {taskId}',
  'diagnostics.lifecycle': 'Ciclo de vida',
  'diagnostics.lifecycleCurrent': 'Estado actual: {state}',
  'diagnostics.attempt': 'Intento {attempt} de {max}',
  'diagnostics.elapsed': 'Tiempo transcurrido',
  'diagnostics.elapsedValue': '{seconds} s',
  'diagnostics.createdAt': 'Encolada a las',
  'diagnostics.updatedAt': 'Última actualización',
  'diagnostics.queuedNoWorkerTitle': 'Nada está procesando esta tarea',
  'diagnostics.queuedNoWorker':
    'La tarea está en cola y la API informa que no hay ningún trabajador en línea, así que ningún proceso la va a recoger. No va lenta: no se está ejecutando en absoluto. Permanece en la cola y empezará en cuanto se conecte un trabajador; no hace falta que la vuelvas a encolar.',
  'diagnostics.progressLabel': 'Progreso de la tarea',
  'diagnostics.progressNone': 'El trabajador todavía no ha informado del progreso.',
  'diagnostics.workerId': 'Trabajador',
  'diagnostics.workerRuntime': 'Entorno del trabajador',
  'diagnostics.processedAt': 'Procesada a las',
  'diagnostics.echoed': 'Mensaje devuelto',
  'diagnostics.succeededTitle': 'La tarea terminó correctamente',
  'diagnostics.succeededBody':
    'El recorrido completo funcionó: web → API → cola → trabajador → resultado guardado → esta pantalla.',
  'diagnostics.failedTitle': 'La tarea falló',
  'diagnostics.failureCode': 'Código de error',
  'diagnostics.failureMessage': 'Mensaje informado',
  'diagnostics.failureRetryable': 'El servidor considera que este fallo se puede reintentar.',
  'diagnostics.failureNotRetryable': 'El servidor considera que este fallo es definitivo.',
  'diagnostics.cancelledTitle': 'Tarea cancelada',
  'diagnostics.cancelledBody': 'La tarea se detuvo antes de producir un resultado.',
  'diagnostics.cancel': 'Cancelar tarea',
  'diagnostics.cancelBusy': 'Solicitando la cancelación',
  'diagnostics.cancelRequested':
    'Cancelación solicitada. El trabajo en curso se detiene en su siguiente punto seguro, así que el estado puede tardar en cambiar.',
  'diagnostics.rawResult': 'JSON del resultado sin procesar',
  'diagnostics.rawResultNone': 'La tarea no ha devuelto ningún resultado.',
  'diagnostics.resultUnrecognised':
    'El resultado no coincide con la forma esperada de noop_echo. Se muestra sin procesar más abajo en lugar de adivinarlo.',
  'diagnostics.pollingPaused': 'El sondeo está en pausa mientras esta pestaña está oculta.',
  'diagnostics.startAnother': 'Iniciar otra ejecución',
  'diagnostics.loadFailed': 'No se pudo leer la tarea.',

  'taskState.queued': 'En cola',
  'taskState.leased': 'Asignada',
  'taskState.succeeded': 'Completada',
  'taskState.failed': 'Fallida',
  'taskState.cancelled': 'Cancelada',
  'taskState.queued.description': 'Esperando a que un trabajador la reclame.',
  'taskState.leased.description': 'Un trabajador tiene la concesión y la está ejecutando.',
  'taskState.succeeded.description': 'El trabajador devolvió un resultado validado.',
  'taskState.failed.description': 'El trabajador informó un fallo, o se agotaron los intentos.',
  'taskState.cancelled.description': 'Se detuvo antes de terminar a petición tuya.',

  'tasks.title': 'Tareas',
  'tasks.intro': 'Trabajo en segundo plano de este espacio de trabajo, del más reciente al más antiguo.',
  'tasks.caption': 'Tareas recientes',
  'tasks.columnType': 'Tipo',
  'tasks.columnState': 'Estado',
  'tasks.columnProgress': 'Progreso',
  'tasks.columnAttempt': 'Intento',
  'tasks.columnCreated': 'Encolada a las',
  'tasks.columnUpdated': 'Última actualización',
  'tasks.loading': 'Cargando tareas',
  'tasks.emptyTitle': 'Todavía no se ha ejecutado ninguna tarea',
  'tasks.emptyBody':
    'Este espacio de trabajo nunca ha encolado una tarea en segundo plano. Es una lista vacía, no una consulta fallida.',
  'tasks.emptySuggestionDiagnostics':
    'Ejecuta la prueba de diagnóstico de M0 para encolar una tarea real.',
  'tasks.emptySuggestionWorker':
    'Comprueba en el panel que el trabajador está en línea: sin él, las tareas se encolan pero nunca se ejecutan.',
  'tasks.endOfList': 'Esas son todas las tareas que devolvió la API.',
  'tasks.cancelRequestedShort': 'Cancelación solicitada',
  'tasks.loadFailed': 'No se pudo cargar la lista de tareas.',

  'notImplemented.badge': 'Sin implementar',
  'notImplemented.title': '{screen} aún no está disponible',
  'notImplemented.milestone': 'Se entrega en el hito {milestone}.',
  'notImplemented.intro':
    'Esta pantalla no tiene controles funcionales. En lugar de mostrar un formulario que pareciera guardar algo, enumera lo que falta.',
  'notImplemented.missingTitle': 'Qué falta',
  'notImplemented.noFakeData':
    'Aquí no se muestran empleos, coincidencias ni postulaciones de ejemplo. La especificación prohíbe inventarlos como si fueran resultados reales.',
  'notImplemented.profile.missing':
    'Edición manual del perfil, subida del CV, extracción de PDF y DOCX, la revisión de importación con diferencias por campo y las revisiones de datos confirmados frente a borradores.',
  'notImplemented.discover.missing':
    'Preferencias de búsqueda, el registro de fuentes, los conectores de Greenhouse y Lever, la programación de escaneos y el informe de cobertura.',
  'notImplemented.jobs.missing':
    'Registros de empleo normalizados, filtros, puntuaciones de coincidencia con su cobertura, distintivos de elegibilidad y actualidad, y las vistas de guardados y excluidos.',
  'notImplemented.cvStudio.missing':
    'Los modos de CV original y adaptado, las plantillas, la selección de idioma, la revisión de datos y cambios, y las descargas en PDF y DOCX.',
  'notImplemented.applications.missing':
    'Los paquetes de postulación, el banco de respuestas, las preguntas obligatorias sin resolver y la instantánea de aprobación con su hash de contenido.',
  'notImplemented.tracker.missing':
    'La lista de estados, las pruebas del resultado, la cronología de eventos y la prevención de postulaciones duplicadas.',
  'notImplemented.settings.missing':
    'La configuración de proveedores y modelos, los presupuestos, las opciones de prompts y plantillas, los horarios de escaneo, los dispositivos emparejados y la exportación y eliminación de datos.',

  'status.not_checked.label': 'Sin comprobar',
  'status.not_checked.description':
    'Todavía nada ha revisado esto. No es un resultado negativo.',
  'status.unknown.label': 'Desconocido',
  'status.unknown.description':
    'Se comprobó y no se pudo determinar la respuesta. Desconocido nunca cuenta como un sí.',
  'status.needs_your_answer.label': 'Necesita tu respuesta',
  'status.needs_your_answer.description':
    'Algo no puede continuar hasta que aportes o confirmes un dato. No se adivina nada por ti.',
  'status.ready_for_review.label': 'Listo para revisar',
  'status.ready_for_review.description':
    'Hay un borrador preparado esperando a que lo leas. No se ha enviado nada.',
  'status.waiting_for_submission.label': 'Pendiente de envío',
  'status.waiting_for_submission.description':
    'Lo aprobaste, y el envío final todavía tienes que hacerlo tú en tu navegador.',
  'status.submitted_verified.label': 'Enviado — verificado',
  'status.submitted_verified.description':
    'Se capturó una prueba del envío, como una página de confirmación o un correo de acuse de recibo.',
  'status.submitted_reported_by_you.label': 'Enviado — según tu informe',
  'status.submitted_reported_by_you.description':
    'Nos dijiste que lo enviaste. No se capturó ninguna prueba, así que queda registrado como tu informe, no como un hecho verificado.',

  'notFound.title': 'Esa página no existe',
  'notFound.body':
    'No hay ninguna pantalla registrada en esta dirección. Puede pertenecer a un hito que todavía no se ha construido.',
  'notFound.home': 'Ir al panel',

  'error.title': 'Eso no funcionó',
  'error.workPreserved': 'No se borró nada de lo que escribiste: corrígelo y vuelve a intentarlo.',
  'error.fieldsTitle': 'Campos que el servidor rechazó',
  'error.boundaryTitle': 'Esta pantalla dejó de funcionar',
  'error.boundaryBody':
    'Un error inesperado llegó a la capa superior de la aplicación. Los detalles de abajo son el error real, no un marcador de posición.',
  'error.network':
    'No se pudo contactar con la API. Comprueba que está funcionando y que tienes conexión.',
  'error.unexpected': 'Ocurrió un error inesperado.',
  'error.VALIDATION_ERROR':
    'El servidor rechazó parte de este formulario. Revisa los campos señalados.',
  'error.MALFORMED_REQUEST': 'La solicitud estaba mal formada y el servidor la rechazó.',
  'error.UNAUTHENTICATED': 'No has iniciado sesión, o tu sesión caducó.',
  'error.FORBIDDEN': 'Esta cuenta no tiene permiso para hacer eso.',
  'error.NOT_FOUND': 'Ese elemento no existe, o no es visible para este espacio de trabajo.',
  'error.CONFLICT':
    'Alguien o algo más cambió esto mientras trabajabas. Recarga y vuelve a aplicar tu cambio.',
  'error.STALE_REVISION':
    'Alguien o algo más cambió esto mientras trabajabas. Recarga para obtener la versión actual y vuelve a aplicar tu cambio: tu edición no se guardó.',
  'error.IDEMPOTENCY_MISMATCH':
    'Esa clave de idempotencia ya se usó con un cuerpo de solicitud distinto. Inicia una ejecución nueva en lugar de reintentar esta.',
  'error.PAYLOAD_TOO_LARGE': 'El archivo es mayor de lo que acepta esta instalación.',
  'error.UNPROCESSABLE': 'El servidor entendió la solicitud, pero los valores no son utilizables.',
  'error.QUOTA_EXCEEDED':
    'Se alcanzó un límite. Espera antes de reintentar, o reduce la frecuencia de las solicitudes.',
  'error.SETUP_CLOSED':
    'La configuración ya se completó en esta instalación y no puede ejecutarse otra vez.',
  'error.BUDGET_EXHAUSTED':
    'El presupuesto configurado se agotó. La revisión y la exportación siguen funcionando; se bloquean las nuevas inferencias.',
  'error.PROVIDER_UNAVAILABLE':
    'El proveedor del modelo no respondió. No se sustituyó por otro proveedor y tu trabajo se conservó.',
  'error.INTERNAL_ERROR':
    'El servidor tuvo un error interno. El ID de solicitud de abajo lo identifica en los registros.',
};

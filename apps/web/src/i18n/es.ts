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
  'nav.unavailableHint': 'Abre una explicación de lo que falta. No es una pantalla funcional.',

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
    'La especificación también sitúa aquí la configuración del proveedor de IA, una prueba de conexión y la importación opcional del perfil. Están en Ajustes y Perfil una vez iniciada la sesión, en lugar de duplicarse aquí.',

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
    'Los hitos M2 a M7 todavía no están construidos. El documento de estado de implementación es el único registro de lo que está hecho.',
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
  'tasks.intro':
    'Trabajo en segundo plano de este espacio de trabajo, del más reciente al más antiguo.',
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
  'status.not_checked.description': 'Todavía nada ha revisado esto. No es un resultado negativo.',
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

  // --- M1: perfil ----------------------------------------------------------
  'fact.confirmed': 'Confirmado',
  'fact.confirmedDescription':
    'Confirmaste este dato. Solo los datos confirmados pueden usarse en CVs y postulaciones.',
  'fact.draft': 'Borrador — listo para revisar',
  'fact.draftDescription':
    'Propuesto por una importación o guardado sin confirmar. No es un dato hasta que lo confirmes, y nada se genera a partir de él.',

  'factKind.contact': 'Contacto',
  'factKind.contact.plural': 'Datos de contacto',
  'factKind.summary': 'Resumen',
  'factKind.summary.plural': 'Resumen',
  'factKind.experience': 'Experiencia',
  'factKind.experience.plural': 'Experiencia',
  'factKind.education': 'Formación',
  'factKind.education.plural': 'Formación',
  'factKind.skill': 'Habilidad',
  'factKind.skill.plural': 'Habilidades',
  'factKind.language': 'Idioma',
  'factKind.language.plural': 'Idiomas',
  'factKind.authorization': 'Autorización de trabajo',
  'factKind.authorization.plural': 'Autorización de trabajo y elegibilidad',
  'factKind.project': 'Proyecto',
  'factKind.project.plural': 'Proyectos',
  'factKind.certification': 'Certificación',
  'factKind.certification.plural': 'Certificaciones',

  'factField.full_name': 'Nombre completo',
  'factField.email': 'Correo electrónico',
  'factField.phone': 'Teléfono',
  'factField.city': 'Ciudad',
  'factField.country': 'País',
  'factField.links': 'Enlaces',
  'factField.text': 'Texto del resumen',
  'factField.employer': 'Empleador',
  'factField.title': 'Puesto',
  'factField.start_month': 'Mes de inicio',
  'factField.end_month': 'Mes de fin',
  'factField.period': 'Periodo',
  'factField.current': 'Es mi puesto actual',
  'factField.currentStudies': 'Sigo estudiando aquí',
  'factField.currentLabel': 'actualidad',
  'factField.employment_type': 'Tipo de empleo',
  'factField.location': 'Ubicación',
  'factField.bullets': 'Puntos',
  'factField.evidence_reference': 'evidencia',
  'factField.skills': 'Habilidades',
  'factField.institution': 'Institución',
  'factField.degree': 'Título',
  'factField.subject': 'Materia',
  'factField.canonical_name': 'Nombre de la habilidad',
  'factField.aliases': 'Alias',
  'factField.user_declared_proficiency': 'Nivel (declarado por ti)',
  'factField.years': 'Años de experiencia',
  'factField.code': 'Código de idioma',
  'factField.declared_level': 'Nivel (declarado por ti)',
  'factField.authorized': 'Autorizado para trabajar en este país',
  'factField.sponsorship_required': 'Requiere patrocinio de visa',
  'factField.note': 'Nota',
  'factField.name': 'Nombre',
  'factField.role': 'Rol',
  'factField.url': 'URL',
  'factField.issuer': 'Emisor',
  'factField.issued_month': 'Emitida',
  'factField.expires_month': 'Vence',
  'factField.credential_id': 'ID de la credencial',
  'factField.notStated': 'No indicado',

  'factForm.required': 'Este campo es obligatorio.',
  'factForm.monthFormat': 'Usa el formato AAAA-MM, por ejemplo 2023-09.',
  'factForm.monthDescription': 'Mes de calendario como AAAA-MM.',
  'factForm.endMonthDescription': 'Déjalo vacío si no ha terminado.',
  'factForm.endBeforeStart': 'El mes de fin no puede ser anterior al mes de inicio.',
  'factForm.currentHasEnd':
    'Un puesto actual no puede tener también un mes de fin. Borra el mes de fin o desmarca "actual".',
  'factForm.currentDescription':
    'Si está marcado, el mes de fin debe estar vacío. El servidor rechaza un puesto actual con fecha de fin.',
  'factForm.yearsRange': 'Los años deben estar entre 0 y 70.',
  'factForm.languageCode': 'Usa un código de dos letras como es, o es-MX.',
  'factForm.languageCodeDescription': 'Código ISO 639-1, opcionalmente con región: en, es, pt-BR.',
  'factForm.countryCode': 'Usa un código ISO de país de dos letras, como US o ES.',
  'factForm.countryCodeDescription': 'Código ISO 3166-1 alfa-2, por ejemplo US, DE o MX.',
  'factForm.listDescription': 'Una entrada por línea.',
  'factForm.summaryDescription':
    'Tus propias palabras. Se guarda exactamente como lo escribes y nunca se reescribe sin tu revisión.',
  'factForm.proficiencyDescription':
    'Solo tú lo declaras. Nada infiere un nivel a partir de una mención en el CV, así que "No declarado" es una respuesta válida.',
  'factForm.authorizedDescription':
    'Si hoy puedes trabajar legalmente en este país. "Desconocido" es una respuesta real y nunca se trata como sí.',
  'factForm.sponsorshipDescription':
    'Si un empleador tendría que patrocinarte. Es independiente de la respuesta anterior; "Desconocido" sigue siendo desconocido.',
  'factForm.bulletsDescription':
    'Logros o responsabilidades. Cada punto lleva una referencia a su origen.',
  'factForm.bulletText': 'Punto {n}',
  'factForm.bulletEvidence': 'Referencia de evidencia del punto {n}',
  'factForm.bulletEvidenceDescription':
    'De dónde procede: una página o párrafo de tu documento, o una nota de que lo escribiste tú.',
  'factForm.addBullet': 'Añadir punto',
  'factForm.removeBullet': 'Quitar punto {n}',
  'factForm.linkLabel': 'Etiqueta del enlace {n}',
  'factForm.linkUrl': 'URL del enlace {n}',
  'factForm.addLink': 'Añadir enlace',
  'factForm.removeLink': 'Quitar enlace {n}',
  'factForm.confirmedLabel': 'Marcar este dato como confirmado',
  'factForm.confirmedDescription':
    'Márcalo solo si es exacto. Los datos confirmados son los únicos que un CV o una postulación pueden usar. Si no lo marcas, queda como borrador.',

  'employmentType.full_time': 'Tiempo completo',
  'employmentType.part_time': 'Tiempo parcial',
  'employmentType.contract': 'Contrato',
  'employmentType.internship': 'Prácticas',
  'employmentType.temporary': 'Temporal',
  'employmentType.freelance': 'Freelance',
  'employmentType.unknown': 'Desconocido',

  'proficiency.notDeclared': 'No declarado',
  'proficiency.beginner': 'Principiante',
  'proficiency.intermediate': 'Intermedio',
  'proficiency.advanced': 'Avanzado',
  'proficiency.expert': 'Experto',

  'languageLevel.basic': 'Básico',
  'languageLevel.conversational': 'Conversacional',
  'languageLevel.professional': 'Profesional',
  'languageLevel.native': 'Nativo',

  'triState.yes': 'Sí',
  'triState.no': 'No',
  'triState.unknown': 'Desconocido',
  'triState.unknownDescription':
    'No establecido. Desconocido nunca cuenta como sí; bloquea la preparación de la postulación hasta que lo resuelvas.',

  'profile.title': 'Perfil',
  'profile.intro':
    'Tus datos, agrupados por tipo. Cada dato está confirmado por ti o es un borrador pendiente de tu revisión; los dos nunca se mezclan. Solo los datos confirmados pueden aparecer en un CV o una postulación.',
  'profile.importLink': 'Importar desde un PDF, DOCX o texto pegado',
  'profile.stateTitle': 'Borrador frente a confirmado',
  'profile.revisionInfo':
    'Revisión del perfil {revision}. Última revisión confirmada: {confirmed}.',
  'profile.noConfirmedRevision': 'ninguna: todavía no existe ningún dato confirmado',
  'profile.loading': 'Cargando tu perfil…',
  'profile.loadFailed': 'No se pudo cargar el perfil.',
  'profile.saved': 'Guardado. El perfil está ahora en la revisión {revision}.',
  'profile.saving': 'Guardando',
  'profile.reload': 'Recargar el perfil (lo que escribiste se conserva)',
  'profile.contactTitle': 'Contacto',
  'profile.contactDescription':
    'El bloque de contacto que se usa en CVs y postulaciones. Guardarlo aquí cuenta como tu confirmación.',
  'profile.contactEmpty': 'Todavía no hay datos de contacto.',
  'profile.addContact': 'Añadir datos de contacto',
  'profile.editContact': 'Editar datos de contacto',
  'profile.saveContact': 'Guardar datos de contacto',
  'profile.addFact': 'Añadir {kind}',
  'profile.saveFact': 'Guardar dato',
  'profile.editFact': 'Editar',
  'profile.confirmFact': 'Confirmar como exacto',
  'profile.deleteFact': 'Eliminar',
  'profile.deleteTitle': '¿Eliminar este dato?',
  'profile.deleteBody':
    'El dato se quita de tu perfil. No se puede deshacer desde la aplicación; nada más cambia.',
  'profile.deleteConfirm': 'Eliminar dato',
  'profile.sectionEmpty': 'Sin {kind} todavía. Es una lista vacía, no una consulta fallida.',
  'profile.sourceExcerpt': 'Extracto de origen',
  'profile.sourceFile': 'Documento de origen',
  'profile.supersedes': 'Reemplaza al dato',
  'profile.factRevision': 'Revisión {revision} · actualizado {updated}',
  'profile.valueUnreadable':
    'Este valor no tiene la forma que requiere su tipo y se muestra como ilegible en lugar de adivinarlo.',

  // --- M1: revisión de importación ----------------------------------------
  'import.title': 'Revisión de importación',
  'import.intro':
    'Extrae datos de un documento o de texto pegado y revisa cada propuesta. Nada llega a tu perfil hasta que lo aceptes explícitamente; los datos confirmados existentes nunca se sobrescriben en silencio.',
  'import.backToProfile': 'Volver al perfil',
  'import.unavailableTitle': 'La importación de perfil no está disponible en esta instalación',
  'import.unavailableBody':
    'La API informa de que la importación de perfil no está implementada aquí, así que no se puede encolar nada desde esta pantalla.',
  'import.workerOfflineWarning':
    'La API informa de que no hay ningún worker en línea. Una importación encolada ahora quedará en cola hasta que arranque un worker; no fallará y no se ejecutará.',
  'import.step1Title': '1. Elige un origen',
  'import.sourceLegend': 'Origen',
  'import.sourceFile': 'Subir un documento',
  'import.sourceFileDescription': 'PDF o DOCX, hasta 10 MiB. Los documentos cifrados se rechazan.',
  'import.sourceText': 'Pegar texto',
  'import.sourceTextDescription':
    'Una exportación de LinkedIn o cualquier texto plano tuyo. No se extrae nada de LinkedIn; solo se usa el texto que pegues.',
  'import.fileLabel': 'Documento',
  'import.fileDescription': 'Se comprueba en el navegador antes de subirlo: solo tipo y tamaño.',
  'import.fileRequired': 'Elige primero un archivo PDF o DOCX.',
  'import.fileTooLarge': 'Ese archivo supera los 10 MiB y no se subió.',
  'import.fileWrongType': 'Solo se aceptan archivos PDF y DOCX. Ese archivo no se subió.',
  'import.uploadFirst': 'Sube el documento antes de encolar la extracción.',
  'import.selectedFile': 'Seleccionado: {name} ({size} KiB)',
  'import.upload': 'Subir documento',
  'import.uploading': 'Subiendo',
  'import.formatHintLabel': 'Pista de formato',
  'import.formatHintDescription':
    'Indica al worker qué esperar. "Detectar" deja que el worker decida según el contenido.',
  'import.validationTitle': 'Lo que el servidor encontró en el archivo',
  'import.validationFile': 'Archivo almacenado',
  'import.validationSignature': 'Firma del archivo reconocida',
  'import.validationExtension': 'La extensión coincide con la firma',
  'import.validationEncrypted': 'Cifrado',
  'import.validationScan': 'Análisis de malware',
  'import.encryptedBlocked':
    'El servidor informa de que este documento está cifrado, así que la extracción de texto no puede funcionar. Elige una copia sin cifrar.',
  'import.textLabel': 'Texto pegado',
  'import.textDescription':
    'Se envía al worker tal cual. Las instrucciones ocultas en el texto se ignoran y se informan como aviso, no se obedecen.',
  'import.textRequired': 'Pega primero algún texto.',
  'import.step2Title': '2. Encolar la extracción',
  'import.step2Body':
    'El worker extrae el texto y pide al modelo configurado datos en borrador. Sin proveedor configurado, la extracción se ejecuta igualmente y devuelve lo que puede, con un aviso.',
  'import.queue': 'Encolar extracción',
  'import.queueing': 'Encolando',
  'import.taskTitle': 'Tarea de extracción {taskId}',
  'import.failedTitle': 'La extracción falló',
  'import.startOver': 'Iniciar otra importación',
  'import.loadingReview': 'Cargando los borradores…',
  'import.reviewLoadFailed': 'No se pudo cargar el resultado de la extracción.',
  'import.alreadyConfirmedTitle': 'Esta importación ya se confirmó',
  'import.alreadyConfirmedBody':
    'Sus borradores aceptados están en el perfil y el resto se descartó. No se puede confirmar dos veces.',
  'import.notReady': 'Esta importación está en "{status}" y todavía no hay nada que revisar.',
  'import.reviewTitle': '3. Revisa cada borrador',
  'import.reviewIntro':
    'Cada borrador empieza sin aceptar. Compara el extracto de origen con el valor propuesto, edítalo si hace falta y acepta solo lo que sea cierto. Los borradores no aceptados se descartan al confirmar.',
  'import.reviewCounts': '{drafts} borradores · {conflicts} conflictos · {warnings} avisos',
  'import.warningsTitle': 'Avisos de la extracción',
  'import.noDraftsTitle': 'No se extrajo ningún borrador',
  'import.noDraftsBody':
    'El worker no devolvió datos utilizables. Revisa los avisos de arriba; confirmar esta importación no cambia nada.',
  'import.sourceTitle': 'Origen',
  'import.noExcerpt': 'No se informó ningún extracto para este borrador.',
  'import.locator': 'Ubicación',
  'import.confidence':
    'Confianza del análisis {value}%: solo una ayuda de análisis, nunca una confirmación.',
  'import.proposedTitle': 'Valor propuesto',
  'import.editValue': 'Editar valor',
  'import.applyEdit': 'Aplicar edición',
  'import.revertEdit': 'Volver al valor extraído',
  'import.editedBadge': 'Editado por ti',
  'import.conflictBadge': 'Entra en conflicto con un dato confirmado',
  'import.acceptedBadge': 'Se añadirá',
  'import.acceptLabel': 'Aceptar este borrador en mi perfil',
  'import.acceptDescription':
    'Desmarcado por defecto. Aceptarlo lo convierte en un dato confirmado con este extracto como procedencia.',
  'import.conflictTitle': 'Un dato confirmado existente choca con este borrador',
  'import.existingMissing': 'El dato existente no está en el perfil actual; recarga el perfil.',
  'import.conflictLegend': '¿Qué debe ocurrir?',
  'import.conflictDescription':
    'Nada se fusiona automáticamente. Arriba se muestran ambos valores; elige de forma explícita.',
  'import.conflictKeep': 'Conservar el dato existente y descartar este borrador',
  'import.conflictKeepDescription': 'El borrador no se añade y el dato existente no se toca.',
  'import.conflictReplace': 'Reemplazar el dato existente por este borrador',
  'import.conflictReplaceOne': 'Reemplazar el dato existente {id} por este borrador',
  'import.conflictReplaceDescription':
    'El dato existente deja de estar confirmado y se conserva en el historial; el borrador pasa a ser el dato confirmado y apunta a él.',
  'import.conflictBoth': 'Conservar ambos',
  'import.conflictBothDescription': 'El borrador se añade junto al dato existente.',
  'import.acceptedCount': 'Se añadirán {accepted} de {total} borradores',
  'import.confirm': 'Confirmar selección',
  'import.confirming': 'Confirmando',
  'import.confirmNote':
    'Se aplica sobre la revisión {revision} del perfil. Si el perfil cambió mientras tanto, el servidor lo rechaza y puedes recargar.',
  'import.confirmEmptyTitle': '¿Confirmar sin aceptar nada?',
  'import.confirmEmptyBody':
    'No hay ningún borrador aceptado. Confirmar cierra esta importación y descarta todos los borradores; el perfil no cambia.',
  'import.confirmEmptyAction': 'Descartar todos los borradores',

  'formatHint.auto': 'Detectar según el contenido',
  'formatHint.pdf': 'PDF',
  'formatHint.docx': 'DOCX',
  'formatHint.linkedin_export_text': 'Texto de exportación de LinkedIn',
  'formatHint.plain_text': 'Texto plano',

  'malwareScan.clean': 'Analizado: limpio',
  'malwareScan.skipped_not_configured':
    'Sin analizar: no hay ningún escáner configurado (esto no es "limpio")',
  'malwareScan.quarantined': 'En cuarentena',
  'malwareScan.pending': 'Análisis pendiente',

  'importWarning.EXTRACTION_SHORT':
    'Se extrajo muy poco texto. El documento puede estar escaneado, ser casi todo imágenes o estar casi vacío; los borradores pueden estar incompletos.',
  'importWarning.PAGES_TRUNCATED':
    'El documento superó el límite de páginas; las últimas no se leyeron.',
  'importWarning.CHARS_TRUNCATED': 'El texto superó el límite de caracteres; el final no se leyó.',
  'importWarning.TABLE_LAYOUT_UNCERTAIN':
    'No se pudo leer con fiabilidad la estructura de una tabla; revisa los valores que vengan de tablas.',
  'importWarning.DATE_AMBIGUOUS': 'Una fecha no se pudo leer sin ambigüedad; revisa los meses.',
  'importWarning.FIELD_DROPPED_INVALID':
    'Se descartó un borrador porque su valor no coincidía con su tipo. No se ofrece para aceptarlo.',
  'importWarning.MODEL_CORRECTED_ONCE':
    'La salida del modelo fue inválida una vez y se hizo un único intento de corrección.',
  'importWarning.NO_PROVIDER_CONFIGURED':
    'No hay ningún proveedor de IA configurado, así que no se infirió ningún dato del texto. Configura uno en Ajustes › Proveedor de IA, o añade los datos a mano.',
  'importWarning.PROMPT_INJECTION_TEXT_IGNORED':
    'El texto contenía instrucciones dirigidas al modelo. Se eliminaron e ignoraron; el documento se trató solo como datos.',

  // --- M1: ajustes ---------------------------------------------------------
  'settings.title': 'Ajustes',
  'settings.intro':
    'Preferencias de búsqueda y proveedor del modelo. Cada cambio se guarda sobre una revisión; si algo más cambió antes, el guardado se rechaza y puedes recargar.',
  'settings.tabsLabel': 'Secciones de ajustes',
  'settings.preferencesTab': 'Preferencias',
  'settings.providerTab': 'Proveedor de IA',
  'settings.missingTitle': 'Todavía no está en esta pantalla',
  'settings.missingBody':
    'Los horarios de rastreo, los dispositivos emparejados, más opciones de prompts y plantillas, y la exportación y el borrado de datos llegan con hitos posteriores. Están ausentes en lugar de mostrarse como controles que no hacen nada.',

  'preferences.loading': 'Cargando preferencias…',
  'preferences.loadFailed': 'No se pudieron cargar las preferencias.',
  'preferences.revision': 'Revisión {revision} · versión del esquema de ajustes {version}',
  'preferences.saved': 'Guardado. Las preferencias están ahora en la revisión {revision}.',
  'preferences.saving': 'Guardando',
  'preferences.save': 'Guardar preferencias',
  'preferences.saveBlocked':
    'El guardado está bloqueado hasta que los pesos sumen exactamente 100.',
  'preferences.reload': 'Recargar las preferencias del servidor (descarta tus cambios)',
  'preferences.integerRequired': 'Escribe un número entero.',
  'preferences.listHint': 'Una entrada por línea.',
  'preferences.searchTitle': 'Búsqueda',
  'preferences.target_titles': 'Puestos objetivo',
  'preferences.excluded_titles': 'Puestos excluidos',
  'preferences.required_skills': 'Habilidades requeridas',
  'preferences.requiredSkillsHint':
    'Una por línea. Pesan el doble que las preferidas en el componente de habilidades.',
  'preferences.preferred_skills': 'Habilidades preferidas',
  'preferences.excluded_companies': 'Empresas excluidas',
  'preferences.excludedCompaniesHint':
    'Una por línea. Los empleos de estos empleadores se ocultan por defecto.',
  'preferences.countries': 'Países',
  'preferences.countriesHint':
    'Códigos ISO de dos letras, uno por línea (US, ES, MX). Remoto no implica mundial; la elegibilidad se comprueba por país.',
  'preferences.countryCodesInvalid': 'Cada entrada debe ser un código ISO de país de dos letras.',
  'preferences.languages': 'Idiomas de trabajo',
  'preferences.languagesHint': 'Códigos como en, es o pt-BR, uno por línea.',
  'preferences.languageCodesInvalid': 'Cada entrada debe ser un código de idioma como en o pt-BR.',
  'preferences.remote_modes': 'Modalidades de trabajo',
  'preferences.remoteModesHint': 'Qué modalidades estás dispuesto a considerar.',
  'preferences.employment_types': 'Tipos de empleo',
  'preferences.salaryTitle': 'Salario',
  'preferences.salaryNoConversion':
    'No se hace ninguna conversión de moneda ni de periodo. Un empleo solo se compara cuando indica la misma moneda y el mismo periodo; si no, su salario sigue siendo desconocido.',
  'preferences.salaryEnabled': 'Establecer un salario mínimo',
  'preferences.salaryMinimum': 'Mínimo',
  'preferences.salaryMinimumInvalid': 'Escribe un número de cero o más.',
  'preferences.salaryCurrency': 'Moneda',
  'preferences.salaryCurrencyHint': 'Código ISO 4217, por ejemplo USD o EUR.',
  'preferences.currencyInvalid': 'Usa un código ISO de moneda de tres letras.',
  'preferences.salaryPeriod': 'Periodo',
  'preferences.eligibilityTitle': 'Elegibilidad',
  'preferences.sponsorship_policy': 'Política de patrocinio',
  'preferences.sponsorshipHint':
    'Cómo se tratan los empleos que requieren patrocinio de visa. Un patrocinio desconocido nunca cuenta como coincidencia.',
  'preferences.unknown_eligibility_policy': 'Cuando la elegibilidad es desconocida',
  'preferences.eligibilityHint':
    'La elegibilidad desconocida bloquea la preparación de la postulación en cualquier caso; esto solo decide si el empleo sigue visible.',
  'preferences.weightsTitle': 'Pesos de coincidencia',
  'preferences.weightsIntro':
    'Números enteros no negativos que deben sumar exactamente 100. La puntuación que producen es un ranking heurístico, no una probabilidad de ser contratado.',
  'preferences.weightDefault': 'Por defecto {value}.',
  'preferences.weightsSum': 'Suma actual: {sum}.',
  'preferences.weightsNotNumeric': 'Cada peso debe ser un número entero.',
  'preferences.weightsMustSum': 'Los pesos deben sumar exactamente 100.',
  'preferences.weightsStaleNote':
    'Cambiar los pesos deja obsoleta cualquier coincidencia calculada; las puntuaciones se recalculan en el siguiente rastreo.',
  'preferences.cvTitle': 'CV',
  'preferences.cv_language': 'Idioma de los CVs nuevos',
  'preferences.cv_template': 'Plantilla de CV',
  'preferences.resume_mode': 'Modo de CV',
  'preferences.limitsTitle': 'Límites operativos',
  'preferences.limitsIntro':
    'Los valores por defecto del piloto se muestran bajo cada campo. Un operador alojado puede imponer máximos más estrictos; tú siempre puedes elegir valores más estrictos.',
  'preferences.scan_interval_hours': 'Intervalo de rastreo (horas)',
  'preferences.pilotDefault': 'Por defecto en el piloto: {value}.',
  'preferences.promptTitle': 'Estilo del prompt',
  'preferences.prompt_style_suffix': 'Sufijo de estilo (solo estilo)',
  'preferences.promptStyleHint':
    'Opcional. Puede cambiar el tono o el énfasis del texto generado. No puede anular las restricciones factuales: nada de cualificaciones, empleadores, fechas o cifras inventadas, diga lo que diga.',

  'remoteMode.remote': 'Remoto',
  'remoteMode.hybrid': 'Híbrido',
  'remoteMode.onsite': 'Presencial',

  'salaryPeriod.year': 'al año',
  'salaryPeriod.month': 'al mes',
  'salaryPeriod.week': 'a la semana',
  'salaryPeriod.day': 'al día',
  'salaryPeriod.hour': 'a la hora',

  'sponsorshipPolicy.allow': 'Permitir',
  'sponsorshipPolicy.allow.description':
    'Los empleos que requieren patrocinio siguen siendo elegibles.',
  'sponsorshipPolicy.avoid': 'Evitar',
  'sponsorshipPolicy.avoid.description':
    'Los empleos que indican que se requiere patrocinio se marcan como no elegibles.',
  'sponsorshipPolicy.unknown': 'Desconocido',
  'sponsorshipPolicy.unknown.description':
    'No lo has decidido. El patrocinio queda como desconocido para cada empleo hasta que lo hagas.',

  'eligibilityPolicy.review': 'Mostrar para revisar',
  'eligibilityPolicy.review.description':
    'Los empleos con elegibilidad desconocida siguen visibles y se marcan como desconocidos.',
  'eligibilityPolicy.hide': 'Ocultar',
  'eligibilityPolicy.hide.description':
    'Los empleos con elegibilidad desconocida se ocultan por defecto; aún puedes inspeccionarlos.',

  'matchWeight.skills': 'Habilidades',
  'matchWeight.role_title': 'Rol / puesto',
  'matchWeight.seniority': 'Seniority',
  'matchWeight.work_arrangement': 'Modalidad / ubicación',
  'matchWeight.industry': 'Sector',

  'cvTemplate.simple': 'Simple (una columna)',

  'resumeMode.original': 'Archivo original',
  'resumeMode.original.description':
    'Tu CV subido se usa byte a byte; nada se convierte ni se adapta.',
  'resumeMode.tailored': 'Adaptado',
  'resumeMode.tailored.description':
    'Un CV generado solo a partir de datos confirmados y revisado por ti antes de usarlo.',

  'limit.scan_max_jobs': 'Máximo de empleos por rastreo',
  'limit.request_concurrency_per_host': 'Solicitudes simultáneas por host',
  'limit.ai_requests_per_day': 'Solicitudes de IA por día',
  'limit.fill_attempts_per_day': 'Intentos de relleno de formularios por día',
  'limit.approval_ttl_hours': 'Validez de la aprobación (horas)',
  'limit.consented_evidence_capture':
    'Capturar evidencia del envío (capturas de pantalla) con mi consentimiento',
  'limit.raw_logs': 'Conservar registros sin filtrar',

  'provider.loading': 'Cargando los ajustes del proveedor…',
  'provider.loadFailed': 'No se pudieron cargar los ajustes del proveedor.',
  'provider.saved': 'Ajustes del proveedor guardados.',
  'provider.saving': 'Guardando',
  'provider.save': 'Guardar ajustes del proveedor',
  'provider.externalTitle': 'La entrada de las tareas sale de esta máquina',
  'provider.externalBody':
    'El proveedor guardado envía el texto de cada tarea (texto del perfil, descripciones de empleo, prompts) a un servicio externo. No se envía nada hasta que se ejecute una tarea, y no se sustituye por otro proveedor si falla.',
  'provider.connectionTitle': 'Proveedor',
  'provider.provider': 'Proveedor',
  'provider.providerHint':
    'Elección explícita. No hay ningún respaldo automático de un proveedor local a uno en la nube.',
  'provider.model': 'Modelo',
  'provider.modelHint': 'El identificador exacto del modelo que espera el proveedor.',
  'provider.modelRequired': 'Escribe un identificador de modelo.',
  'provider.baseUrl': 'URL base',
  'provider.baseUrlHint':
    'Punto de acceso del proveedor. Los puntos locales deben estar en la lista permitida del operador; el servidor lo comprueba al guardar.',
  'provider.baseUrlRequired': 'Escribe la URL del punto de acceso de este proveedor.',
  'provider.noBaseUrl': 'Este proveedor no usa una URL de punto de acceso.',
  'provider.apiKeyStatus': 'Clave de API almacenada',
  'provider.apiKeySet': 'Configurada (termina en {masked})',
  'provider.apiKeyNotSet': 'Sin configurar',
  'provider.apiKey': 'Nueva clave de API',
  'provider.apiKeyHint':
    'Solo escritura. La clave almacenada nunca se muestra aquí y este campo nunca se rellena. Déjalo vacío para conservar la clave almacenada.',
  'provider.clearKey': 'Quitar la clave de API almacenada',
  'provider.clearKeyHint': 'Guardar con esto marcado borra la clave almacenada.',
  'provider.limitsTitle': 'Límites',
  'provider.numberRequired': 'Escribe un número.',
  'provider.optionalLimit': 'Opcional. Vacío significa sin tope.',
  'provider.costBudgetHint':
    'Opcional. Solo se puede aplicar con una tarifa; sin ella, el coste es desconocido y este tope no hace nada.',
  'provider.costBudgetUnenforceable':
    'Hay un presupuesto de coste diario pero no hay ninguna tarifa configurada. El coste no se puede medir, así que este presupuesto no se puede aplicar; solo se aplican los topes de tokens y solicitudes.',
  'provider.rateCardTitle': 'Tarifa',
  'provider.rateCardIntro':
    'Precios por millón de tokens, usados para estimar y liquidar el coste. Sin tarifa, el coste se informa como desconocido (no como cero) y no se puede aplicar un presupuesto de coste.',
  'provider.rateCardEnabled': 'Indicar una tarifa',
  'provider.noRateCard':
    'Sin tarifa: el coste es desconocido, no cero. Los topes de tokens y solicitudes siguen aplicándose.',
  'provider.rateCurrency': 'Moneda',
  'provider.rateInput': 'Coste de entrada por millón de tokens',
  'provider.rateOutput': 'Coste de salida por millón de tokens',
  'provider.testTitle': 'Probar conexión',
  'provider.testIntro':
    'Sondea únicamente el proveedor guardado; no es un descargador de URLs genérico. Informa de lo observado y nada más.',
  'provider.testUnsaved':
    'Tienes cambios sin guardar. La prueba usa los ajustes guardados, no lo que hay en el formulario.',
  'provider.test': 'Probar conexión',
  'provider.testing': 'Probando',
  'provider.reachable': 'Accesible',
  'provider.modelAvailable': 'Modelo disponible',
  'provider.structuredOutput': 'Salida estructurada compatible',
  'provider.notDetermined': 'Sin determinar',
  'provider.latency': 'Latencia',
  'provider.latencyValue': '{ms} ms',
  'provider.detail': 'Detalle',

  'providerId.none': 'Ninguno',
  'providerId.none.description':
    'Sin modelo. La edición manual del perfil, la importación de empleos y el seguimiento siguen funcionando; la extracción y la generación informan de que no hay proveedor configurado.',
  'providerId.fake': 'Falso (determinista, para pruebas)',
  'providerId.fake.description':
    'Devuelve salida de prueba. Sirve para ejercitar la canalización; nunca uses su salida como datos reales.',
  'providerId.ollama': 'Ollama (local)',
  'providerId.ollama.description':
    'Un modelo que se ejecuta en tu máquina o tu red. La entrada de las tareas se queda en local. Sigue haciendo falta internet para la búsqueda de empleo en vivo.',
  'providerId.openai_compatible':
    'Punto de acceso compatible con OpenAI (envía la entrada de las tareas al exterior)',
  'providerId.openai_compatible.description':
    'Una API alojada. La entrada de las tareas sale de esta máquina hacia el punto de acceso que configures; ese proveedor puede cobrar por su uso.',

  'providerLimit.context_limit': 'Límite de contexto (tokens)',
  'providerLimit.output_token_limit': 'Límite de tokens de salida',
  'providerLimit.temperature': 'Temperatura',
  'providerLimit.timeout_seconds': 'Tiempo de espera (segundos)',
  'providerLimit.daily_token_budget': 'Presupuesto diario de tokens',
  'providerLimit.daily_cost_budget': 'Presupuesto diario de coste',
};

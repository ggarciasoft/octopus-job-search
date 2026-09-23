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
  'error.PROTOCOL_UNSUPPORTED':
    'La extensión del navegador y esta instalación usan versiones de protocolo distintas. Actualiza la que sea más antigua.',
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
    'Preferencias de búsqueda, proveedor del modelo, dispositivos vinculados y tus datos. Cada cambio se guarda sobre una revisión; si algo más cambió antes, el guardado se rechaza y puedes recargar.',
  'settings.tabsLabel': 'Secciones de ajustes',
  'settings.preferencesTab': 'Preferencias',
  'settings.providerTab': 'Proveedor de IA',
  'settings.missingTitle': 'Todavía no está en esta pantalla',
  'settings.missingBody':
    'Los horarios de rastreo, y más opciones de prompts y plantillas, llegan con hitos posteriores. Están ausentes en lugar de mostrarse como controles que no hacen nada. La exportación y el borrado están en la pestaña Privacidad.',

  'settingsFile.title': 'Archivo de ajustes',
  'settingsFile.intro':
    'Guarda tus preferencias y los portales que sigues en un archivo JSON, para tener una copia o para configurar otra instalación igual. El archivo nunca incluye tu proveedor de IA ni su clave, tus respuestas guardadas ni nada de tu perfil.',
  'settingsFile.export': 'Exportar ajustes',
  'settingsFile.exporting': 'Exportando',
  'settingsFile.importLabel': 'Importar un archivo de ajustes',
  'settingsFile.importDescription':
    'Un archivo .json exportado desde Job Getter. No cambia nada hasta que confirmes.',
  'settingsFile.notJson': 'Ese archivo no es JSON, así que no puede ser un archivo de ajustes.',
  'settingsFile.tooLarge':
    'Ese archivo es mucho más grande de lo que puede ser un archivo de ajustes.',
  'settingsFile.confirmTitle': '¿Importar {name}?',
  'settingsFile.confirmPreferences':
    'Cada preferencia de esta página se sustituirá por la del archivo, y se perderán los cambios sin guardar. Las coincidencias aparecerán como desactualizadas hasta que se vuelvan a puntuar.',
  'settingsFile.confirmBoards':
    'Portales en el archivo: {count}. Se añadirán los que aún no sigues. Los que ya tienes se quedan exactamente como están, y no se elimina ninguno.',
  'settingsFile.confirmBoardsUnknown':
    'Se añadirán los portales del archivo que aún no sigues. Los que ya tienes se quedan exactamente como están, y no se elimina ninguno.',
  'settingsFile.confirm': 'Importar',
  'settingsFile.importing': 'Importando',
  'settingsFile.imported':
    'Importado. Las preferencias están ahora en la revisión {revision}. Portales añadidos: {created}. Ya estaban: {present}.',

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

  // --- M2: Descubrir ------------------------------------------------------------
  'discover.title': 'Descubrir',
  'discover.intro':
    'Registra tablones públicos de empleo y escanéalos, o importa una sola oferta desde una URL pública o texto pegado.',
  'discover.coverageTitle': 'Qué cubre el descubrimiento',
  'discover.coverageBody':
    'Los escaneos leen solo los tablones registrados aquí y las URL que importas. Nada busca en todo internet, y ningún tablón se lee si no lo añades. Los listados públicos no son un directorio completo de empresas: una oferta que no esté en un tablón registrado no aparecerá.',
  'discover.unavailableTitle': 'El descubrimiento de empleos no está disponible en este servidor',
  'discover.unavailableBody':
    'La API indica que el descubrimiento de empleos no está disponible, así que añadir tablones, escanear e importar están desactivados aquí. Ningún control de abajo encolará trabajo.',
  'discover.workerOfflineWarning':
    'La API no informa de ningún worker en línea. Un escaneo o una importación encolados ahora quedarán en cola hasta que arranque un worker; no fallarán y no se ejecutarán.',
  'discover.controlUnavailable':
    'Desactivado porque la API indica que el descubrimiento de empleos no está disponible.',

  'boards.title': 'Tablones',
  'boards.intro':
    'Solo funcionan tablones públicos: un token de tablón de Greenhouse o un slug de sitio de Lever que cualquiera pueda abrir sin iniciar sesión. Registrar un tablón no concede permiso para rastrearlo; los escaneos siguen los límites documentados y un tablón que rechaza repetidamente se marca como bloqueado y se deja en paz.',
  'boards.loading': 'Cargando tablones…',
  'boards.loadFailed': 'No se pudieron cargar los tablones.',
  'boards.caption': 'Tablones configurados',
  'boards.columnBoard': 'Tablón',
  'boards.columnHealth': 'Estado',
  'boards.columnLastSuccess': 'Último escaneo correcto',
  'boards.columnNextScan': 'Próximo escaneo programado',
  'boards.columnJobs': 'Empleos',
  'boards.columnActions': 'Acciones',
  'boards.emptyTitle': 'No hay tablones registrados',
  'boards.emptyBody':
    'No se escanea nada hasta que se registre un tablón. No se muestran tablones de ejemplo.',
  'boards.emptySuggestionAdd':
    'Añade abajo un token de tablón de Greenhouse o un slug de sitio de Lever.',
  'boards.emptySuggestionImport': 'O importa una sola oferta desde una URL o texto pegado.',
  'boards.endpoint': 'Punto de acceso: {url}',
  'boards.neverSucceeded': 'Nunca',
  'boards.nextScanDue': 'Pendiente en la próxima pasada del planificador',
  'boards.nextScanNotScheduled': 'No se programa mientras el tablón esté desactivado o bloqueado',
  'boards.lastError': 'Último error: {code}',
  'boards.consecutiveFailures': '{count} fallos consecutivos',
  'boards.scanNow': 'Escanear ahora',
  'boards.scanning': 'Encolando escaneo…',
  'boards.scanBlockedReason':
    'El escaneo está desactivado: el tablón respondió con rechazos repetidos. Reactívalo para intentarlo de nuevo.',
  'boards.scanDisabledReason':
    'El escaneo está desactivado: el tablón está desactivado. Actívalo para escanear.',
  'boards.enable': 'Activar',
  'boards.reenable': 'Reactivar',
  'boards.disable': 'Desactivar',
  'boards.updating': 'Actualizando…',
  'boards.delete': 'Eliminar',
  'boards.deleteTitle': '¿Eliminar este tablón?',
  'boards.deleteBody':
    'El tablón de {connector} "{boardKey}" dejará de escanearse. Los empleos ya encontrados a través de él se conservan, con su procedencia; solo se elimina el vínculo con este tablón.',
  'boards.deleteConfirm': 'Eliminar tablón, conservar empleos',
  'boards.deleting': 'Eliminando…',
  'boards.viewLastScan': 'Ver último escaneo',
  'boards.actionFailed': 'La acción sobre "{boardKey}" no se completó.',
  'boards.jobCount': '{count} empleos',

  'addBoard.title': 'Añadir un tablón',
  'addBoard.connector': 'Conector',
  'addBoard.boardKey': 'Clave del tablón',
  'addBoard.boardKeyRequired': 'Introduce la clave del tablón.',
  'addBoard.boardKeyPattern': 'Usa solo letras, dígitos, puntos, guiones y guiones bajos.',
  'addBoard.greenhouseHelp':
    'El token de tablón de Greenhouse es la última parte de la URL de un tablón público, como https://boards.greenhouse.io/<token> o https://job-boards.greenhouse.io/<token>. Solo funcionan tablones públicos; un tablón tras un inicio de sesión no puede leerse.',
  'addBoard.leverHelp':
    'El slug de sitio de Lever es la parte que sigue a jobs.lever.co/ en la URL de una página pública de ofertas, como https://jobs.lever.co/<slug>. Solo funcionan páginas públicas de ofertas.',
  'addBoard.leverEu': 'Este tablón de Lever está alojado en la región de la UE',
  'addBoard.leverEuDescription':
    'Envía base_url {url}, el punto de acceso documentado de la UE, en lugar del predeterminado. Elígelo solo cuando la URL pública esté en jobs.eu.lever.co.',
  'addBoard.submit': 'Añadir tablón',
  'addBoard.submitting': 'Añadiendo…',
  'addBoard.added':
    'Tablón "{boardKey}" añadido. Su primer escaneo se encola en la próxima pasada del planificador; usa "Escanear ahora" para iniciar uno de inmediato.',

  'scan.title': 'Estado del escaneo',
  'scan.intro': 'Sigue un escaneo encolado desde esta página o el último escaneo de un tablón.',
  'scan.none':
    'No se está siguiendo ningún escaneo. Usa "Escanear ahora" o "Ver último escaneo" en un tablón.',
  'scan.loading': 'Leyendo el escaneo…',
  'scan.loadFailed': 'No se pudo leer el escaneo.',
  'scan.heading': 'Escaneo {id}',
  'scan.forBoard': 'Tablón: {board}',
  'scan.snapshotComplete':
    'Instantánea completa: se obtuvieron todas las páginas, así que un empleo ausente de ella cuenta para el cierre.',
  'scan.snapshotPartialTitle': 'Este escaneo fue parcial',
  'scan.snapshotPartialBody':
    'No se obtuvieron todas las páginas, así que no es una imagen completa del tablón. No se cerró nada por este escaneo: un empleo ausente de una instantánea parcial no se considera desaparecido.',
  'scan.unchangedTitle': 'Sin cambios desde el último escaneo',
  'scan.unchangedBody':
    'El tablón informó de que no hay cambios desde el último escaneo correcto, así que no se volvió a obtener nada y no se creó, actualizó ni cerró ningún empleo. El tablón sigue listando {count} empleos aquí.',
  'scan.snapshotPending': 'Si la instantánea es completa se sabrá cuando termine el escaneo.',
  'scan.warningsPending': 'Leyendo las notas de la obtención…',
  'scan.countsTitle': 'Recuentos',
  'scan.count.fetched': 'Obtenidos',
  'scan.count.created': 'Nuevos',
  'scan.count.updated': 'Actualizados',
  'scan.count.unchanged': 'Sin cambios',
  'scan.count.closed': 'Cerrados',
  'scan.count.pages': 'Páginas',
  'scan.errorTitle': 'El escaneo informó de un error',
  'scan.startedAt': 'Inicio',
  'scan.completedAt': 'Fin',
  'scan.notYet': 'Todavía no',
  'scan.viewJobs': 'Ver empleos',
  'scan.stopFollowing': 'Dejar de seguir',
  'scan.queuedNoWorker':
    'El escaneo está en cola y la API no informa de ningún worker en línea, así que ningún proceso lo tomará. Permanece en la cola y arranca en cuanto se conecte un worker; no necesitas encolarlo de nuevo.',
  'scan.notesTitle': 'Notas de la obtención',

  'scanStatus.queued': 'En cola',
  'scanStatus.running': 'En ejecución',
  'scanStatus.succeeded': 'Correcto',
  'scanStatus.partial': 'Parcial',
  'scanStatus.failed': 'Fallido',
  'scanStatus.cancelled': 'Cancelado',
  'scanStatus.queued.description': 'Esperando a que un worker lo tome.',
  'scanStatus.running.description': 'Un worker está obteniendo el tablón.',
  'scanStatus.succeeded.description': 'Se obtuvieron todas las páginas dentro de los límites.',
  'scanStatus.partial.description':
    'Se obtuvo algo pero no una instantánea completa, o el tablón informó de que no hay cambios. Un escaneo parcial no cierra nada.',
  'scanStatus.failed.description': 'La obtención falló. No se cambió ningún empleo.',
  'scanStatus.cancelled.description': 'El escaneo se canceló antes de terminar.',

  'sourceHealth.unknown': 'Aún sin escanear',
  'sourceHealth.ok': 'Correcto',
  'sourceHealth.degraded': 'Degradado',
  'sourceHealth.blocked': 'Bloqueado',
  'sourceHealth.disabled': 'Desactivado',
  'sourceHealth.unknown.description':
    'Aún no ha terminado ningún escaneo, así que no se sabe nada de este tablón.',
  'sourceHealth.ok.description': 'El último escaneo fue correcto.',
  'sourceHealth.degraded.description':
    'Los escaneos recientes fallaron o fueron parciales; el escaneo continúa.',
  'sourceHealth.blocked.description':
    'El tablón rechazó repetidamente (403 o 429). El escaneo se detuvo y sigue detenido hasta que reactives el tablón.',
  'sourceHealth.disabled.description': 'Desactivaste este tablón. No se escanea.',

  'connector.greenhouse': 'Greenhouse',
  'connector.lever': 'Lever',
  'connector.manual': 'Descripción pegada',
  'connector.url': 'URL importada',

  'jobImport.title': 'Importar una oferta',
  'jobImport.intro':
    'Pega la URL pública de una página de empleo, o pega tú mismo el texto de la descripción. Lo que aportes se guarda como fuente; no se le añade nada sin un extracto que lo respalde.',
  'jobImport.modeLegend': 'Fuente',
  'jobImport.modeUrl': 'URL pública',
  'jobImport.modeUrlDescription':
    'Solo https. La página se obtiene sin cookies ni credenciales, se lee primero como datos estructurados JobPosting y, si no, como texto.',
  'jobImport.modeText': 'Descripción pegada',
  'jobImport.modeTextDescription':
    'Úsalo cuando una página no pueda obtenerse o rechace el acceso automatizado. Indica la empresa y el título para que el empleo sea identificable.',
  'jobImport.url': 'URL de la página del empleo',
  'jobImport.urlRequired': 'Introduce la URL https de la página del empleo.',
  'jobImport.text': 'Texto de la descripción',
  'jobImport.textDescription': 'Al menos 20 caracteres. Se guarda exactamente como se pegó.',
  'jobImport.textRequired': 'Pega el texto de la descripción (al menos 20 caracteres).',
  'jobImport.hintsTitle': 'Datos opcionales',
  'jobImport.company': 'Empresa',
  'jobImport.jobTitle': 'Título',
  'jobImport.applyUrl': 'URL de solicitud',
  'jobImport.applyUrlDescription':
    'Se usa solo cuando la propia página no indica un enlace de solicitud.',
  'jobImport.submit': 'Importar',
  'jobImport.submitting': 'Encolando importación…',
  'jobImport.taskTitle': 'Tarea de importación {taskId}',
  'jobImport.queuedNoWorker':
    'La importación está en cola y la API no informa de ningún worker en línea, así que ningún proceso la tomará. Permanece en la cola y arranca en cuanto se conecte un worker; no necesitas encolarla de nuevo.',
  'jobImport.failedTitle': 'La importación falló',
  'jobImport.createdTitle': 'Empleo importado',
  'jobImport.createdBody':
    'La oferta se guardó con su fuente. Revísala antes de fiarte de cualquier campo.',
  'jobImport.openJob': 'Abrir el empleo',
  'jobImport.chooseTitle': 'Se encontraron varias ofertas en esa página',
  'jobImport.chooseBody':
    'No se creó ningún empleo. Elige la oferta que querías; se importa desde su propia URL.',
  'jobImport.choose': 'Importar esta oferta',
  'jobImport.refusedTitle': 'No se pudo obtener la página',
  'jobImport.refusedBody':
    'La obtención fue rechazada o no está permitida, y esta aplicación no sortea un rechazo. Si tienes la oferta abierta en tu navegador, pega su texto en su lugar.',
  'jobImport.nothingTitle': 'No se pudo leer ninguna oferta en esa página',
  'jobImport.nothingBody':
    'La página se obtuvo pero no se reconoció ninguna oferta de empleo en ella. Puedes pegar el texto de la descripción en su lugar.',
  'jobImport.switchToPaste': 'Pegar la descripción en su lugar',
  'jobImport.warningsTitle': 'Notas de la obtención',
  'jobImport.startOver': 'Iniciar otra importación',
  'jobImport.resultUnreadable':
    'La tarea terminó pero su resultado no tenía la forma esperada. No se supuso nada sobre él.',
  'jobImport.awaitingOutcome': 'La tarea terminó; leyendo su resultado…',

  'fetchWarning.RATE_LIMITED': 'El sitio pidió menos peticiones (límite de frecuencia).',
  'fetchWarning.ACCESS_DENIED': 'El sitio denegó el acceso.',
  'fetchWarning.NOT_MODIFIED': 'El tablón informó de que no hay cambios desde la última obtención.',
  'fetchWarning.PAGE_LIMIT_REACHED': 'Se alcanzó el límite de páginas de un escaneo.',
  'fetchWarning.JOB_LIMIT_REACHED': 'Se alcanzó el límite de empleos de un escaneo.',
  'fetchWarning.SCHEMA_DRIFT': 'Los datos de la fuente no coincidían con la forma esperada.',
  'fetchWarning.ROBOTS_DISALLOWED':
    'Las directivas robots del sitio no permiten obtener esta página.',
  'fetchWarning.BLOCKED_DESTINATION': 'El destino no es una dirección pública y no se contactó.',
  'fetchWarning.REDIRECT_LIMIT': 'Demasiadas redirecciones.',
  'fetchWarning.CONTENT_TYPE_REJECTED': 'La respuesta no era una página HTML ni JSON-LD.',
  'fetchWarning.BODY_TRUNCATED': 'La página superaba el límite de tamaño y se cortó.',
  'fetchWarning.NO_STRUCTURED_DATA':
    'No se encontraron datos estructurados JobPosting; se usó el texto.',
  'fetchWarning.MULTIPLE_POSTINGS': 'La página lista varias ofertas.',
  'fetchWarning.FIELD_INFERRED':
    'Un campo se infirió del texto circundante en lugar de leerse directamente.',
  'fetchWarning.FIELD_DROPPED_INVALID': 'Se descartó un campo porque su valor no era válido.',

  // --- M2: Empleos --------------------------------------------------------------
  'jobs.title': 'Empleos',
  'jobs.intro':
    'Todos los empleos encontrados a través de tus tablones e importaciones. Un empleo solo se puntúa cuando compruebas su idoneidad, así que un empleo sin comprobar muestra "Sin comprobar" en lugar de una puntuación baja.',
  'jobs.filtersLegend': 'Filtros',
  'jobs.query': 'Buscar por título o empresa',
  'jobs.status': 'Estado',
  'jobs.statusAny': 'Cualquier estado',
  'jobs.savedOnly': 'Solo guardados',
  'jobs.includeExcluded': 'Mostrar empleos excluidos',
  'jobs.includeExcludedDescription':
    'Los empleos de empresas de tu lista de exclusión se ocultan por defecto. Al mostrarlos, cada uno lleva su motivo.',
  'jobs.applyFilters': 'Aplicar filtros',
  'jobs.clearFilters': 'Limpiar filtros',
  'jobs.loading': 'Cargando empleos…',
  'jobs.loadFailed': 'No se pudieron cargar los empleos.',
  'jobs.caption': 'Empleos',
  'jobs.columnJob': 'Empleo',
  'jobs.columnWhere': 'Ubicación',
  'jobs.columnType': 'Tipo',
  'jobs.columnSalary': 'Salario',
  'jobs.columnStatus': 'Estado',
  'jobs.columnFreshness': 'Actualidad',
  'jobs.columnMatch': 'Coincidencia',
  'jobs.columnSources': 'Fuentes',
  'jobs.columnActions': 'Acciones',
  'jobs.emptyTitle': 'No hay empleos que mostrar',
  'jobs.emptyBody': 'Esta lista está vacía. No se muestran empleos de ejemplo en su lugar.',
  'jobs.emptySuggestionBoards': 'Añade un tablón en la pantalla Descubrir.',
  'jobs.emptySuggestionScan':
    'Ejecuta un escaneo de un tablón registrado o importa una sola oferta.',
  'jobs.emptySuggestionFilters':
    'Relaja los filtros: limpia la búsqueda, permite cualquier estado o muestra los empleos excluidos.',
  'jobs.endOfList': 'No hay más empleos.',
  'jobs.save': 'Guardar',
  'jobs.unsave': 'Quitar de guardados',
  'jobs.saving': 'Guardando…',
  'jobs.savedBadge': 'Guardado',
  'jobs.updateFailed': 'El cambio en "{title}" no se guardó.',
  'jobs.reload': 'Recargar la lista',
  'jobs.sourceOne': '1 fuente',
  'jobs.sourceMany': '{count} fuentes',
  'jobs.duplicatesFlag': 'Posible duplicado',
  'jobs.duplicatesFlagDescription':
    'Parecido a otro empleo. Un título y una ubicación similares por sí solos son un aviso, nunca una fusión automática.',
  'jobs.excluded': 'Excluido: {reason}',
  'jobs.locationNone': 'Ubicación no indicada',
  'jobs.salaryUnknown': 'Salario desconocido',
  'jobs.salaryUnknownDescription':
    'La oferta no indica salario. Desconocido no es cero ni una suposición.',
  'jobs.salaryCurrencyUnknown': 'moneda no indicada',
  'jobs.salaryPeriodUnknown': 'periodo no indicado',
  'jobs.lastSeen': 'Visto por última vez {when}',
  'jobs.stale': 'Puede estar desactualizado — vuelve a comprobarlo antes de postular',
  'jobs.staleDescription':
    'La última obtención correcta tiene más de {hours} horas. La oferta puede haber cambiado o cerrado.',
  'jobs.neverFetched':
    'No hay ninguna obtención correcta registrada — vuelve a comprobarlo antes de postular',
  'jobs.fresh': 'Obtenido en las últimas {hours} horas',
  'jobs.matchNotCheckedDescription':
    'Aún no se ha calculado ninguna coincidencia para este empleo. No es una puntuación baja.',
  'jobs.employmentTypeNotStated': 'Tipo de empleo no indicado',

  'jobStatus.active': 'Activo',
  'jobStatus.closed': 'Cerrado',
  'jobStatus.unknown': 'Desconocido',
  'jobStatus.active.description': 'Listado por su fuente en el último escaneo correcto.',
  'jobStatus.closed.description':
    'Ausente de dos instantáneas completas con al menos 24 horas de diferencia, cerrado por la fuente o marcado como cerrado por ti.',
  'jobStatus.unknown.description':
    'No se pudo determinar la disponibilidad. Desconocido no es activo ni cerrado.',

  'remoteType.remote': 'Remoto',
  'remoteType.hybrid': 'Híbrido',
  'remoteType.onsite': 'Presencial',
  'remoteType.unknown': 'Modalidad de trabajo no indicada',

  'jobDetail.back': 'Volver a empleos',
  'jobDetail.loading': 'Cargando empleo…',
  'jobDetail.loadFailed': 'No se pudo cargar el empleo.',
  'jobDetail.revision': 'Revisión {revision}',
  'jobDetail.markClosed': 'Marcar como cerrado',
  'jobDetail.markClosedTitle': '¿Marcar este empleo como cerrado?',
  'jobDetail.markClosedBody':
    'Esto registra que consideras cerrada la oferta. Un tablón que siga listándola no la reabrirá.',
  'jobDetail.markClosedConfirm': 'Marcar cerrado',
  'jobDetail.closing': 'Cerrando…',
  'jobDetail.correct': 'Corregir título y empleador',
  'jobDetail.correctTitle': 'Corrige el título y el empleador',
  'jobDetail.correctHelp':
    'Una página sin datos estructurados se lee como texto visible, así que el título y el empleador pueden ser lo que dijera la página. Tu redacción la sustituye y se conserva: las descargas posteriores de esta oferta no la sobrescribirán.',
  'jobDetail.correctSave': 'Guardar corrección',
  'jobDetail.correctTitleLabel': 'Título del puesto',
  'jobDetail.correctCompanyLabel': 'Empleador',
  'jobDetail.correctSaving': 'Guardando…',
  'jobDetail.correctCancel': 'Cancelar',
  'jobDetail.correctedNote': 'El título o el empleador muestran tu redacción, no la de la fuente.',
  'jobDetail.prepareUnavailable':
    'Preparar solicitud aún no está disponible: los paquetes de solicitud llegan en el hito M4. No se muestra ningún botón, así que nada puede aparentar que prepara uno.',
  'jobDetail.reload': 'Recargar el empleo',
  'jobDetail.summaryTitle': 'Resumen',
  'jobDetail.remoteType': 'Modalidad de trabajo',
  'jobDetail.employmentType': 'Tipo de empleo',
  'jobDetail.language': 'Idioma de la oferta',
  'jobDetail.publishedAt': 'Publicado',
  'jobDetail.notStated': 'No indicado',
  'jobDetail.locationsTitle': 'Ubicaciones',
  'jobDetail.locationsNone': 'La oferta no indica ubicación.',
  'jobDetail.readFrom': 'Leído de: “{excerpt}”',
  'jobDetail.eligibilityTitle': 'Elegibilidad',
  'jobDetail.eligibilityNotStated':
    'No indicada — no des por supuesta la elegibilidad. Una oferta remota no significa para todo el mundo.',
  'jobDetail.eligibilityCountries': 'La oferta nombra estos países: {countries}',
  'jobDetail.salaryTitle': 'Salario',
  'jobDetail.salaryAsStated': 'Tal como se indica: “{excerpt}”',
  'jobDetail.salaryNoConversion':
    'Se muestra en la moneda y el periodo que usó la oferta; no se convierte nada.',
  'jobDetail.requirementsTitle': 'Requisitos',
  'jobDetail.requirementsNone':
    'No se extrajo ningún requisito — lee la descripción. La extracción depende de encabezados de sección explícitos, así que una lista vacía significa que no se leyó ninguno, no que el empleo no los tenga.',
  'jobDetail.evidenceExcerpt': 'Extracto del que se leyó',
  'jobDetail.inferredTitle': 'Campos inferidos',
  'jobDetail.inferredIntro':
    'Estos campos no se leyeron de un valor estructurado. Cada uno se infirió del extracto mostrado; comprueba el extracto antes de fiarte del campo.',
  'jobDetail.inferredNone':
    'No se infirió ningún campo; todos los valores anteriores se leyeron directamente de la fuente.',
  'jobDetail.inferredFrom': 'Esto se infirió de:',
  'jobDetail.descriptionTitle': 'Descripción',
  'jobDetail.descriptionNote':
    'Se muestra como texto plano exactamente como se guardó. Las instrucciones dentro de una página de empleo son datos, no órdenes.',
  'jobDetail.provenanceTitle': 'Dónde se vio este empleo',
  'jobDetail.provenanceExternalId': 'Id externo',
  'jobDetail.provenanceCanonical': 'Página de la oferta',
  'jobDetail.provenanceApply': 'Página de solicitud',
  'jobDetail.provenanceApplyNone': 'No se indica enlace de solicitud',
  'jobDetail.provenanceRetrieved': 'Obtenido {when}',
  'jobDetail.provenanceSourceRemoved':
    'El tablón del que procede se eliminó después; el empleo se conserva.',
  'jobDetail.duplicatesTitle': 'Posibles duplicados',
  'jobDetail.duplicatesIntro':
    'No se fusionan automáticamente. Compruébalos antes de postular para no preparar dos veces la misma solicitud.',
  'jobDetail.duplicatesNone': 'No se detectaron posibles duplicados.',
  'jobDetail.freshnessTitle': 'Actualidad',
  'jobDetail.firstSeen': 'Visto por primera vez',
  'jobDetail.lastSeen': 'Visto por última vez',
  'jobDetail.lastFetched': 'Última obtención correcta',
  'jobDetail.contentHash': 'Hash del contenido',
  'jobDetail.opensInNewTab': '(se abre en una pestaña nueva)',

  'requirementKind.required': 'Obligatorio',
  'requirementKind.preferred': 'Deseable',
  'requirementKind.unknown': 'Nivel del requisito no indicado',

  'inferredField.remote_type': 'Modalidad de trabajo',
  'inferredField.locations': 'Ubicaciones',
  'inferredField.eligible_countries': 'Países elegibles',
  'inferredField.employment_type': 'Tipo de empleo',
  'inferredField.salary': 'Salario',
  'inferredField.language': 'Idioma de la oferta',
  'inferredField.requirements': 'Requisitos',

  'duplicateReason.same_apply_url': 'Misma URL de solicitud',
  'duplicateReason.same_requisition': 'Misma requisición',
  'duplicateReason.similar_title_and_location': 'Título y ubicación similares',

  // --- Ajuste (M3) ---------------------------------------------------------

  'match.heading': 'Ajuste',
  'match.heuristicNotice':
    'Esta es una clasificacion heuristica de como encaja la oferta con tu perfil confirmado. No es una probabilidad de ser contratado ni una puntuacion ATS. Lee la evidencia antes de confiar en ella.',
  'match.scoreOutOf': 'de 100',
  'match.coverage': 'Se evaluo el {percent}% de la ponderacion',
  'match.scoreWithCoverage':
    'Clasificacion {score} de 100, a partir del {percent}% de la ponderacion.',
  'match.scoreUnknown': 'No hay suficiente para evaluar',
  'match.scoreUnknownExplanation':
    'No se pudo evaluar nada, asi que no hay clasificacion. Eso no es una puntuacion baja: la oferta y tu perfil no coincidieron en nada que esta version sepa comparar.',
  'match.coverageNote':
    'Esto quedo fuera porque no se pudo leer nada al respecto: {components}. La clasificacion se calculo con el resto.',
  'match.componentsHeading': 'Que se tuvo en cuenta',
  'match.componentValue': '{value} de 100, ponderado {weight}',
  'match.componentNotEvaluated': 'Sin evaluar',
  'match.requirementsHeading': 'Requisitos',
  'match.noRequirements':
    'No se extrajo ningun requisito, asi que no se pudo comprobar ninguno. La extraccion depende de encabezados de seccion explicitos; una lista vacia significa que no se leyo ninguno, no que el puesto no tenga.',
  'match.evidenceFromJob': 'De la oferta',
  'match.evidenceFromProfile': 'De tu perfil',
  'match.matchedVia': 'Coincide con tu habilidad confirmada "{skill}".',
  'match.uncertainExplanation':
    'Tu perfil tiene "{skill}", que esta relacionada pero no es lo mismo. No se conto: darla por valida pondria en tu CV experiencia que no registraste.',
  'match.showRequirementEvidence': 'Ver la linea de la que salio',
  'match.stale': 'Desactualizado',
  'match.staleDescription':
    'Tu perfil, tus preferencias o la oferta cambiaron despues de este calculo.',
  'match.staleNotice':
    'Tu perfil, tus preferencias o la oferta cambiaron despues de este calculo, asi que se muestra tal como estaba. Vuelve a comprobar el ajuste para obtener uno actual.',
  'match.versions': 'Algoritmo {algorithm}, mapa de alias {aliases}.',

  'match.component.skills': 'Habilidades',
  'match.component.role_title': 'Puesto y titulo',
  'match.component.seniority': 'Seniority',
  'match.component.work_arrangement': 'Modalidad de trabajo',
  'match.component.industry': 'Sector',

  'match.unknown.JOB_STATES_NOTHING': 'La oferta no lo dice.',
  'match.unknown.PROFILE_STATES_NOTHING': 'Tu perfil confirmado no lo dice.',
  'match.unknown.NO_CONFIRMED_FACTS': 'Todavia no tienes datos confirmados con los que comparar.',
  'match.unknown.NOT_COMPARABLE': 'No se pudieron comparar sin suponer.',
  'match.unknown.WEIGHT_ZERO': 'Le asignaste peso cero a este componente.',

  'match.outcome.matched': 'Cubierto',
  'match.outcome.uncertain': 'Incierto',
  'match.outcome.missing': 'Sin cubrir',

  'eligibility.heading': 'Puedes postularte?',
  'eligibility.verdict.yes': 'Elegible',
  'eligibility.verdict.no': 'No elegible',
  'eligibility.verdict.unknown': 'Desconocido',
  'eligibility.blocksApplication':
    'Esto hay que responderlo antes de postularse. Desconocido no es un si.',

  'eligibility.filter.excluded_employer': 'Empleador excluido',
  'eligibility.filter.employment_type': 'Tipo de empleo',
  'eligibility.filter.location': 'Elegibilidad por ubicacion',
  'eligibility.filter.work_authorization': 'Autorizacion de trabajo',
  'eligibility.filter.language': 'Idioma',
  'eligibility.filter.salary_minimum': 'Salario minimo',

  'eligibility.code.NOT_CONFIGURED':
    'No has configurado esta preferencia, asi que no se comprobo nada.',
  'eligibility.code.PASSES': 'Nada aqui te descarta.',
  'eligibility.code.EMPLOYER_EXCLUDED': 'Excluiste a este empleador.',
  'eligibility.code.EMPLOYMENT_TYPE_NOT_ACCEPTED': 'No es uno de los tipos de empleo que aceptas.',
  'eligibility.code.EMPLOYMENT_TYPE_NOT_STATED': 'La oferta no indica el tipo de empleo.',
  'eligibility.code.COUNTRY_NOT_ELIGIBLE':
    'La oferta enumera paises y ninguno de los tuyos esta entre ellos.',
  'eligibility.code.COUNTRY_NOT_STATED':
    'La oferta no dice a que paises esta abierta. Remoto no significa en todo el mundo.',
  'eligibility.code.REMOTE_MODE_NOT_ACCEPTED': 'Esta modalidad de trabajo no es una que aceptes.',
  'eligibility.code.AUTHORIZATION_NOT_CONFIRMED':
    'No tienes ningun dato confirmado de autorizacion para los paises que enumera esta oferta.',
  'eligibility.code.AUTHORIZATION_ABSENT':
    'Tu perfil no registra ninguna autorizacion de trabajo, asi que esto no se puede responder.',
  'eligibility.code.SPONSORSHIP_REQUIRED':
    'Necesitarias patrocinio. Si este empleador patrocina es una respuesta suya, no nuestra.',
  'eligibility.code.LANGUAGE_NOT_DECLARED':
    'No has declarado el idioma en el que esta escrita esta oferta.',
  'eligibility.code.LANGUAGE_NOT_STATED': 'La oferta no indica un idioma.',
  'eligibility.code.SALARY_BELOW_MINIMUM':
    'El tope del rango publicado esta por debajo de tu minimo.',
  'eligibility.code.SALARY_NOT_STATED': 'La oferta no indica salario.',
  'eligibility.code.SALARY_NOT_COMPARABLE':
    'El salario esta en una moneda o un periodo distintos de tu minimo. No se convirtio nada.',

  'jobs.minScore': 'Clasificacion minima',
  'jobs.minScoreAny': 'Cualquiera',
  'jobs.minScoreDescription':
    'Solo los puestos que has comprobado pueden pasar este filtro. Un puesto sin comprobar no tiene una puntuacion baja, asi que se deja fuera en lugar de suponerla.',
  'jobs.eligible': 'Elegibilidad',
  'jobs.eligibleAny': 'Cualquiera',

  'jobDetail.checkFit': 'Comprobar ajuste',
  'jobDetail.recheckFit': 'Volver a comprobar el ajuste',
  'jobDetail.checkingFit': 'Comprobando',
  'jobDetail.fitQueued':
    'Comprobando el ajuste. Se ejecuta localmente y no consume presupuesto de IA.',
  'jobDetail.fitFailed': 'La comprobacion de ajuste no termino.',
  'jobDetail.fitNotChecked':
    'Este puesto todavia no se ha comparado con tu perfil. No se puntua nada hasta que lo pidas.',

  // --- Estudio de CV (M3, PR07) --------------------------------------------

  'cvStudio.title': 'Estudio de CV',
  'cvStudio.intro':
    'Genera un CV a partir de los datos que has confirmado, o envia el archivo que subiste tal cual. Desde esta pantalla no se envia nada a ningun sitio.',
  'cvStudio.modeLegend': 'Que CV quieres enviar?',
  'cvStudio.modeTailored': 'Generar uno con mi perfil confirmado',
  'cvStudio.modeTailoredDescription':
    'Construido con tus datos confirmados y ordenado para este puesto. La redaccion puede reordenarse o acortarse; no se anade nada.',
  'cvStudio.modeOriginal': 'Enviar el archivo que subi',
  'cvStudio.modeOriginalDescription':
    'Tu archivo se envia byte por byte. Nunca se convierte, se vuelve a generar ni se adapta.',
  'cvStudio.job': 'Puesto',
  'cvStudio.jobNone': 'Sin puesto: un CV general',
  'cvStudio.language': 'Idioma',
  'cvStudio.pageTarget': 'Longitud objetivo',
  'cvStudio.pageTargetOption': '{count} paginas',
  'cvStudio.pageTargetOptionOne': '1 pagina',
  'cvStudio.file': 'Archivo subido',
  'cvStudio.fileNone': 'Todavia no has subido un CV.',
  'cvStudio.fileUploadLink': 'Sube uno en la pantalla de perfil',
  'cvStudio.generate': 'Generar',
  'cvStudio.generating': 'Generando',
  'cvStudio.useOriginal': 'Usar este archivo',
  'cvStudio.queued':
    'Generando tu CV. Se ejecuta localmente salvo que hayas configurado un proveedor.',
  'cvStudio.failed': 'No se pudo generar el CV.',
  'cvStudio.loadFailed': 'No se pudo cargar el CV.',
  'cvStudio.noProviderNotice':
    'No hay ningun proveedor de IA configurado, asi que el CV se armo directamente con tus datos confirmados, sin reescribir nada. Es un CV completo, solo que no adaptado.',

  'cvStudio.reviewHeading': 'Revisa antes de enviar',
  'cvStudio.reviewNotice':
    'Estas comprobaciones contrastan el documento con tus datos confirmados. Detectan cifras, nombres y fechas inventados. No pueden juzgar si una frase exagera lo que hiciste, asi que leerlo tu mismo no es opcional.',
  'cvStudio.checksPassed': 'Las comprobaciones automaticas no encontraron nada que senalar.',
  'cvStudio.checksFailed':
    'Las comprobaciones automaticas senalaron {count} problema(s). Cada uno aparece abajo con lo que se elimino.',
  'cvStudio.findingsHeading': 'Que encontraron las comprobaciones',
  'cvStudio.findingRemoved': 'Eliminado del CV',
  'cvStudio.findingKept': 'Conservado, pero conviene revisarlo',
  'cvStudio.documentHeading': 'El documento',
  'cvStudio.documentEmpty':
    'El documento no tiene secciones. Confirma algunos datos del perfil y vuelve a generarlo.',
  'cvStudio.factsCited': 'Construido a partir de {count} dato(s) confirmado(s).',
  'cvStudio.provenance': 'Plantilla {template}. {source}',
  'cvStudio.provenanceDeterministic':
    'Armado directamente con tus datos, sin intervencion de ningun modelo.',
  'cvStudio.provenanceModel': 'Presentado por {provider} ({model}), prompt {prompt}.',
  'cvStudio.pages': 'Generado en {count} pagina(s).',

  'cvStudio.downloadsHeading': 'Descargas',
  'cvStudio.downloadPdf': 'Descargar PDF',
  'cvStudio.downloadDocx': 'Descargar DOCX',
  'cvStudio.downloadOriginal': 'Descargar tu archivo original',
  'cvStudio.pdfUnavailable':
    'No se pudo producir el PDF en esta instalacion, asi que solo se ofrece el DOCX. El boton no esta, en lugar de estar roto.',
  'cvStudio.atsNotice':
    'Un diseno simple de una sola columna se interpreta con mas fiabilidad que uno elaborado. Eso mejora las probabilidades; no garantiza que un sistema concreto del empleador lo lea bien.',

  'cvStudio.approveHeading': 'Tu aprobacion',
  'cvStudio.approveNotice':
    'Generar algo no lo aprueba. Lee el documento de arriba y apruebalo tu mismo.',
  'cvStudio.approve': 'He leido esto y lo apruebo',
  'cvStudio.approved': 'Aprobado el {date}',
  'cvStudio.withdraw': 'Retirar la aprobacion',
  'cvStudio.approveFailed': 'No se pudo registrar la aprobacion.',

  'resumeFinding.BULLET_WITHOUT_FACT': 'Una vinneta no citaba ningun dato confirmado.',
  'resumeFinding.UNKNOWN_FACT_ID': 'Algo citaba un dato que no esta en tu perfil.',
  'resumeFinding.NUMBER_NOT_IN_FACTS':
    'Aparecio una cifra que ninguno de los datos citados contiene. Se elimino en lugar de dejarte defenderla en una entrevista.',
  'resumeFinding.NAME_NOT_IN_FACTS': 'Un empleador o una institucion que tu perfil no contiene.',
  'resumeFinding.DATE_NOT_IN_FACTS': 'Una fecha que tu perfil no indica.',
  'resumeFinding.CREDENTIAL_NOT_IN_FACTS':
    'Un identificador de credencial que tu perfil no registra.',
  'resumeFinding.ROLES_MERGED': 'Dos puestos distintos se habian juntado en una sola entrada.',
  'resumeFinding.PROJECT_PRESENTED_AS_EMPLOYMENT':
    'Un proyecto personal se presentaba como empleo.',
  'resumeFinding.SKILL_NOT_CONFIRMED': 'Una habilidad que no has confirmado.',
  'resumeFinding.SECTION_OMITTED_EMPTY':
    'Una seccion quedo vacia despues de eliminar sus entradas.',
  'resumeFinding.PAGE_OVERFLOW':
    'El CV es mas largo que tu objetivo. No se trunco nada ni se redujo el texto; acortalo tu mismo si la longitud importa.',
  'resumeFinding.MODEL_CORRECTED_ONCE':
    'El modelo necesito una correccion para devolver una salida valida.',
  'resumeFinding.NO_PROVIDER_CONFIGURED':
    'No hay proveedor configurado, asi que no se adapto nada.',
  'resumeFinding.MODEL_OUTPUT_REJECTED':
    'El modelo devolvio algo inservible, asi que se usaron tus datos directamente.',
  'resumeFinding.PDF_UNAVAILABLE': 'No se pudo generar el PDF en esta instalacion.',

  'resumeSection.summary': 'Perfil',
  'resumeSection.skills': 'Habilidades',
  'resumeSection.experience': 'Experiencia',
  'resumeSection.projects': 'Proyectos',
  'resumeSection.education': 'Formacion',
  'resumeSection.certifications': 'Certificaciones',
  'resumeSection.languages': 'Idiomas',

  // --- M4: postulaciones, paquetes, el ejecutor local y el seguimiento -----
  'applications.title': 'Postulaciones',
  'applications.intro':
    'Cada postulación es un intento para un empleo. Iniciarla solo registra la intención: el CV, las respuestas y la aprobación son decisiones aparte en la pantalla de revisión.',
  'applications.startFor': 'Iniciar una postulación para',
  'applications.chooseJob': 'Elige un empleo',
  'applications.start': 'Empezar a seguir',
  'applications.starting': 'Iniciando…',
  'applications.allTracked': 'Todos los empleos que descubriste ya tienen una postulación.',
  'applications.tableCaption': 'Postulaciones en curso',
  'applications.columnRole': 'Puesto',
  'applications.columnStatus': 'Estado',
  'applications.columnUpdated': 'Último cambio',
  'applications.emptyTitle': 'Todavía no hay postulaciones',
  'applications.emptyBody':
    'No se ha preparado nada. Descubre un empleo y luego inicia una postulación para él.',
  'applications.emptySuggestion': 'Ver los empleos que descubriste',

  'application.status.draft': 'Borrador',
  'application.status.draft.description': 'Iniciada, sin nada preparado todavía.',
  'application.status.preparing': 'Preparando',
  'application.status.preparing.description': 'Se está armando un paquete.',
  'application.status.needsInput': 'Necesita tu respuesta',
  'application.status.needsInput.description':
    'Una pregunta obligatoria no tiene respuesta. No se adivinará ninguna.',
  'application.status.readyForReview': 'Lista para revisar',
  'application.status.readyForReview.description':
    'Todo está respondido. Lee el paquete y apruébalo si es correcto.',
  'application.status.approved': 'Aprobada',
  'application.status.approved.description':
    'Aprobaste exactamente este contenido. La aprobación caduca, y cualquier cambio en tu perfil, el empleo, el CV o el destino la retira.',
  'application.status.filling': 'Rellenando',
  'application.status.filling.description': 'Un ejecutor emparejado tiene el formulario abierto.',
  'application.status.awaitingUserSubmit': 'Esperando el envío',
  'application.status.awaitingUserSubmit.description':
    'El formulario está relleno y te espera. No se ha enviado nada.',
  'application.status.submitted': 'Enviada',
  'application.status.submitted.description': 'Registrada como enviada.',
  'application.status.outcomeUnknown': 'Resultado desconocido',
  'application.status.outcomeUnknown.description':
    'No pudimos saber si llegó. Eso no es un fallo ni un éxito, y nada se reintentará por su cuenta.',
  'application.status.failed': 'Fallida',
  'application.status.failed.description': 'Algo salió mal antes del envío.',
  'application.status.cancelled': 'Cancelada',
  'application.status.cancelled.description': 'La detuviste antes de enviarla.',
  'application.status.interview': 'Entrevista',
  'application.status.interview.description': 'Te respondieron y avanza.',
  'application.status.rejected': 'Rechazada',
  'application.status.rejected.description': 'Dijeron que no.',
  'application.status.offer': 'Oferta',
  'application.status.offer.description': 'Te hicieron una oferta.',
  'application.status.withdrawn': 'Retirada',
  'application.status.withdrawn.description': 'La retiraste.',

  'application.submitted.verified': 'Enviada — verificada',
  'application.submitted.reported': 'Enviada — según tu informe',
  'application.submitted.unevidenced': 'Enviada — sin pruebas registradas',

  'evidence.adapterObserved': 'Vista en la página de confirmación',
  'evidence.userReport': 'Informada por ti',
  'evidence.none': 'Sin pruebas',

  'applicationEvent.created': 'Postulación iniciada',
  'applicationEvent.packetCreated': 'Paquete preparado',
  'applicationEvent.packetApproved': 'Paquete aprobado',
  'applicationEvent.approvalInvalidated': 'Aprobación retirada: el contenido cambió',
  'applicationEvent.approvalExpired': 'La aprobación caducó',
  'applicationEvent.fillRequested': 'Relleno solicitado',
  'applicationEvent.fillPaused': 'El ejecutor se detuvo',
  'applicationEvent.fillFailed': 'El relleno falló',
  'applicationEvent.submitted': 'Registrada como enviada',
  'applicationEvent.outcomeRecorded': 'Resultado registrado',
  'applicationEvent.cancelled': 'Cancelada',
  'applicationEvent.note': 'Nota',

  'timeline.empty': 'Todavía no ha pasado nada.',
  'timeline.actor.user': 'Tú',
  'timeline.actor.system': 'Sistema',
  'timeline.actor.runner': 'Ejecutor',
  'timeline.transition': '{from} → {to}',

  'staleness.profileRevisionChanged': 'Tu perfil cambió después de armar este paquete.',
  'staleness.jobRevisionChanged': 'La oferta cambió después de armar este paquete.',
  'staleness.resumeChanged': 'El archivo del CV cambió después de armar este paquete.',
  'staleness.destinationChanged': 'La URL de postulación de este empleo cambió.',
  'staleness.formSchemaChanged': 'El formulario cambió desde que se aprobó este paquete.',
  'staleness.approvalExpired': 'La aprobación caducó.',

  'answerProvenance.userEntered': 'Escrita por ti',
  'answerProvenance.answerBank': 'Respuesta guardada',
  'answerProvenance.profileFact': 'De tu perfil',
  'answerProvenance.preference': 'De tus preferencias',

  'unresolved.noAnswer': 'No has respondido esta pregunta.',
  'unresolved.newQuestion': 'El formulario preguntó algo que este paquete no cubre.',
  'unresolved.unsupportedWidget': 'Es un control que el ejecutor no sabe manejar.',
  'unresolved.needsExactMapping':
    'Tu respuesta no coincide exactamente con ninguna opción ofrecida.',
  'unresolved.neverInferable':
    'Una pregunta de evaluación, identidad o demografía. Estas nunca se responden con un valor guardado.',
  'unresolved.fileUploadBlocked': 'No se pudo adjuntar el CV.',

  'packet.heading': 'Lo que se enviará',
  'packet.revision': 'Revisión {revision} del paquete',
  'packet.destination': 'Destino',
  'packet.connector': 'Adaptador {connector} ({version})',
  'packet.staleTitle': 'Este paquete está desactualizado',
  'packet.unresolvedTitle': 'Preguntas obligatorias sin responder',
  'packet.unresolvedBody': 'Faltan {count} respuesta(s) obligatoria(s).',
  'packet.answersHeading': 'Respuestas',
  'packet.noAnswers': 'Este paquete todavía no lleva respuestas.',
  'packet.answerMissing': 'Sin responder',
  'packet.required': 'Obligatoria',
  'packet.neverReuse': 'Nunca se reutiliza',
  'packet.contentHash': 'Hash del contenido',
  'packet.approval': 'Aprobación',
  'packet.notApproved': 'Sin aprobar',
  'packet.approvedUntil': 'Aprobado hasta {expires}',

  'answers.heading': 'Respuestas para esta postulación',
  'answers.empty': 'Todavía no hay preguntas. Añade las que pida el formulario.',
  'answers.useStored': 'Usar respuesta guardada',
  'answers.remember': 'Recordar esta respuesta',
  'answers.rememberDescription': 'Se guarda para reutilizarla, solo donde la aprobaste.',
  'answers.neverReuseNotice':
    'Esta pregunta nunca se responde con un valor guardado; respóndela en el propio formulario.',
  'answers.addLabel': 'Añadir una pregunta',
  'answers.addDescription': 'Escribe la pregunta tal como la formula el formulario.',
  'answers.add': 'Añadir',

  'review.viewJob': 'Ver la oferta',
  'review.duplicateTitle': 'Puede ser la misma oferta que otra postulación',
  'review.duplicateBody':
    'Hay {count} postulación(es) para un empleo con el mismo empleador y puesto. Se mantienen separadas; revísalo antes de enviar ambas.',
  'review.noPacketTitle': 'Todavía no hay nada preparado',
  'review.noPacketBody':
    'Elige un CV y responde las preguntas del formulario, y guarda el paquete.',
  'review.buildHeading': 'Preparar el paquete',
  'review.buildIntro':
    'Guardar crea una nueva revisión del paquete. Cualquier aprobación de la anterior se retira, porque aprobaba otro contenido.',
  'review.resume': 'CV a enviar',
  'review.resumeDescription': 'Solo se listan los CV terminados que este empleo puede usar.',
  'review.resumeChoose': 'Elige un CV',
  'review.resumeOriginal': 'Tu propio archivo, sin cambios ({created})',
  'review.resumeTailored': 'Generado para este empleo ({created})',
  'review.noResumeTitle': 'No hay ningún CV listo',
  'review.noResumeBody': 'Genera uno o sube el tuyo antes de preparar un paquete.',
  'review.cvStudioLink': 'Abrir el estudio de CV',
  'review.savePacket': 'Guardar paquete',
  'review.saving': 'Guardando…',
  'review.approve': 'Aprobar este paquete',
  'review.approving': 'Aprobando…',
  'review.approveNotice':
    'Aprobar registra que leíste exactamente este contenido. Caduca, y cambiar tu perfil, el empleo, el CV o el destino la retira.',
  'review.historyHeading': 'Historial',

  'fill.heading': 'Asistente de relleno',
  'fill.device': 'Ejecutor emparejado',
  'fill.start': 'Abrir el formulario y rellenarlo',
  'fill.starting': 'Iniciando…',
  'fill.noRunnerTitle': 'Sin ejecutor emparejado',
  'fill.noRunnerBody':
    'El relleno ocurre en tu propia máquina, en un navegador que puedes ver. Empareja el ejecutor de escritorio para usarlo; también puedes postularte a mano y registrar el resultado.',
  'fill.pairLink': 'Emparejar un dispositivo',
  'fill.inProgressTitle': 'El ejecutor tiene el formulario abierto',
  'fill.inProgressBody': 'Observa la ventana que abrió. Se detendrá antes de enviar.',
  'fill.awaitingSubmitTitle': 'El formulario está relleno y te espera',
  'fill.awaitingSubmitBody':
    'No se ha enviado nada. Revisa cada campo en la ventana del navegador y envíalo tú.',
  'fill.pausedTitle': 'El ejecutor se detuvo',
  'fill.pausedBody': 'El formulario preguntó algo que este paquete no responde:',
  'fill.neverSubmits':
    'El ejecutor nunca pulsa enviar. Es una decisión de diseño permanente, no una función que falte.',
  'fill.reasonsSummary': 'Por qué un campo puede quedar para ti',

  'devices.title': 'Dispositivos emparejados',
  'devices.intro':
    'Un token de dispositivo permite que un proceso fuera de este navegador actúe sobre tus datos. Empareja solo máquinas que controles y revoca lo que ya no uses.',
  'devices.pairHeading': 'Emparejar un dispositivo',
  'devices.kind': '¿Qué vas a emparejar?',
  'devices.kind.extension': 'Extensión del navegador',
  'devices.kind.extensionDescription':
    'La extensión de Job Getter en tu propio Chrome. Rellena la página que estás viendo.',
  'devices.kind.localRunner': 'Ejecutor local',
  'devices.kind.localRunnerDescription':
    'El ejecutor de escritorio, que rellena formularios en una ventana de navegador propia.',
  'devices.label': 'Nombra este dispositivo',
  'devices.labelDescription': 'Para distinguir dos máquinas antes de revocar una.',
  'devices.origins': 'Orígenes que puede rellenar (opcional)',
  'devices.originsDescription':
    'Separados por comas, por ejemplo https://boards.greenhouse.io. Déjalo vacío para permitir solo el destino exacto de cada paquete aprobado.',
  'devices.pair': 'Crear un código de emparejamiento',
  'devices.pairing': 'Creando…',
  'devices.codeTitle': 'Tu código de emparejamiento',
  'devices.codeBody':
    'Se muestra una vez. Solo se guarda un resumen criptográfico, así que no puede mostrarse de nuevo; crea otro si lo pierdes. Caduca en cinco minutos.',
  'devices.codeCommand':
    'Ejecuta job-getter-runner pair en la máquina y escribe el código cuando lo pida.',
  'devices.codeExtension':
    'Abre la extensión de Job Getter en Chrome, escribe esta dirección y pega el código: {address}',
  'devices.listHeading': 'Dispositivos',
  'devices.emptyTitle': 'Sin dispositivos',
  'devices.emptyBody': 'Nada fuera de este navegador puede actuar sobre tus datos.',
  'devices.notYetPaired': 'Todavía no ha canjeado su código',
  'devices.expires': 'Caduca el {when}',
  'devices.revoke': 'Revocar',
  'device.status.pending': 'Esperando emparejar',
  'device.status.paired': 'Emparejado',
  'device.status.revoked': 'Revocado',
  'device.status.expired': 'Caducado',

  'tracker.title': 'Seguimiento',
  'tracker.intro': 'En qué punto está cada postulación, y en qué se basa eso.',
  'tracker.evidenceTitle': 'Verificado e informado no son lo mismo',
  'tracker.evidenceBody':
    'Un envío que un ejecutor vio llegar se marca como verificado. Uno que nos contaste se marca como informado por ti. La ausencia de pruebas no es fallo ni éxito.',
  'tracker.emptyTitle': 'Todavía no hay seguimiento',
  'tracker.emptyBody': 'Las postulaciones aparecen aquí en cuanto inicias una.',
  'tracker.emptySuggestion': 'Iniciar una postulación',
  'tracker.submittedAt': 'Enviada el {when}',
  'tracker.evidenceKind': 'Pruebas',
  'tracker.outcomeLabel': 'Qué pasó',
  'tracker.reference': 'Referencia',
  'tracker.referenceDescription': 'Cualquier número de confirmación que te mostró el empleador.',
  'tracker.note': 'Nota',
  'tracker.record': 'Registrarlo',
  'tracker.recording': 'Registrando…',
  'tracker.evidenceNotice': 'Se registrará como: {evidence}.',

  'outcome.submitted': 'La envié',
  'outcome.notSubmitted': 'Nunca se envió',
  'outcome.unknown': 'No sé si llegó',
  'outcome.interview': 'Me invitaron a una entrevista',
  'outcome.rejected': 'La rechazaron',
  'outcome.offer': 'Me hicieron una oferta',
  'outcome.withdrawn': 'La retiré',
  'outcome.cancelled': 'Cancelar esta postulación',

  'settings.devicesTab': 'Dispositivos',

  'settings.privacyTab': 'Privacidad',
  'privacy.title': 'Tus datos',
  'privacy.intro':
    'Todo lo que esta instalación guarda sobre ti, en un archivo que puedes conservar. Nada se envía a ningún sitio: el archivo se crea en esta máquina y lo descargas tú.',
  'privacy.exportHeading': 'Exportar',
  'privacy.exportBody':
    'Un ZIP con JSON versionado de tu perfil, preferencias, empleos, CV, respuestas e historial de postulaciones, más los propios archivos.',
  'privacy.excludedHeading': 'Deliberadamente excluido',
  'privacy.excluded.providerSecrets': 'La clave de API de tu proveedor de IA.',
  'privacy.excluded.sessions': 'Las sesiones iniciadas.',
  'privacy.excluded.deviceTokens': 'Los tokens de los dispositivos emparejados.',
  'privacy.excluded.browserProfile':
    'El perfil del navegador del ejecutor local y las sesiones de sitios que contenga.',
  'privacy.excluded.operatorInfrastructure':
    'Registros del operador: tareas en cola, auditoría, uso.',
  'privacy.excluded.stagingFiles': 'Subidas a medio terminar.',
  'privacy.export': 'Crear una exportación',
  'privacy.exporting': 'Creando el archivo…',
  'privacy.exportReadyTitle': 'Tu exportación está lista',
  'privacy.exportReady': '{size}, con {files} archivo(s).',
  'privacy.download': 'Descargar el archivo',
  'privacy.exportFailedTitle': 'La exportación no terminó',
  'privacy.exportFailedBody': 'No se escribió nada. Inténtalo de nuevo.',
  'privacy.deleteHeading': 'Eliminar tu espacio de trabajo',
  'privacy.deleteBody':
    'Esto no se puede deshacer. Si quieres conservar algo, crea antes una exportación arriba.',
  'privacy.deleteEffectAccess':
    'El acceso termina de inmediato: este navegador, cualquier otro con la sesión iniciada y todos los dispositivos emparejados.',
  'privacy.deleteEffectErase':
    'Tu perfil, empleos, CV, respuestas, historial de candidaturas y todos los archivos subidos o generados se borran de esta instalación.',
  'privacy.deleteEffectAccount':
    'Tu cuenta también se elimina. En una instalación local sin otra cuenta, la configuración inicial vuelve a abrirse.',
  'privacy.deleteEffectBackups':
    'Las copias de seguridad anteriores conservan tus datos hasta que caduquen, pero restaurar una vuelve a eliminar el espacio de trabajo.',
  'privacy.deleteConfirmWord': 'ELIMINAR',
  'privacy.deleteConfirmLabel': 'Escribe {word} para confirmar',
  'privacy.deletePasswordLabel': 'Tu contraseña',
  'privacy.deleteSubmit': 'Eliminar mi espacio de trabajo',
  'privacy.deleting': 'Eliminando…',

  'deletion.title': 'Eliminación del espacio de trabajo',
  'deletion.erasingTitle': 'Acceso revocado; el borrado está en curso',
  'deletion.erasingBody':
    'Ya nadie puede iniciar sesión en este espacio de trabajo. Los archivos y registros se siguen borrando; esta página se actualiza sola.',
  'deletion.completedTitle': 'Tu espacio de trabajo se ha eliminado',
  'deletion.completedBody': 'Se borraron {files} archivo(s) y todos los registros el {when}.',
  'deletion.failedTitle': 'El borrado no terminó',
  'deletion.failedBody':
    'El acceso se revocó y nadie puede iniciar sesión, pero el borrado de los archivos falló tras varios intentos. Quien administra esta instalación puede reintentarlo; dale la referencia de abajo.',
  'deletion.reference': 'Referencia:',
  'deletion.setupAgain': 'Configurar esta instalación de nuevo',
};

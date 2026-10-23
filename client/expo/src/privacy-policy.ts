/**
 * The privacy policy, in each app language.
 *
 * Kept as data rather than in the translation catalogs: it is long, it is
 * reviewed as one document, and a change to it should be visible as a change
 * to the policy. Every statement here describes what the code does today; when
 * the product changes what it collects or who it shares with, update this file
 * and `POLICY_UPDATED` in the same change.
 */

import type { AppLang } from './i18n';

/** Date the policy last changed, shown at the top of the page. */
export const POLICY_UPDATED = '2026-10-22';

/** One heading and what sits under it. */
export type PolicySection = {
  title: string;
  /** Paragraphs, in order. */
  body: readonly string[];
  /** A bulleted list after the paragraphs. */
  bullets?: readonly string[];
};

/** A whole policy in one language. */
export type Policy = {
  title: string;
  updatedLabel: string;
  intro: string;
  sections: readonly PolicySection[];
  /** Closing contact line. `{{email}}` is replaced, and the line is left out without an address. */
  contact: string;
};

const en: Policy = {
  title: 'Privacy policy',
  updatedLabel: 'Last updated',
  intro:
    'GamePlan helps teams run a season: schedules, RSVPs, chat, dues, and emergency info. This policy explains what we collect, why, who can see it, and how to delete it. It covers the GamePlan website and the iOS and Android apps.',
  sections: [
    {
      title: 'What we do not do',
      body: [],
      bullets: [
        'We do not sell your information or share it for advertising.',
        'We do not show ads, and we do not use analytics, advertising, or tracking tools in the apps or on the website.',
        'We do not read your device location. Event addresses are typed in by team staff.',
      ],
    },
    {
      title: 'What we collect',
      body: ['We collect only what you, your team, or your guardian enter, plus what is needed to run the service.'],
      bullets: [
        'Account: your email address, display name, and birthday. Your password is held by Amazon Cognito, our sign-in service, and we never see it. If you continue with Apple or Google, they share your name and email address with us.',
        'Profile: a photo and phone number, if you add them, and the positions you play.',
        'Team activity: the teams you are on and your roles, events, RSVPs, lineups, carpools, volunteer sign-ups, chat messages, polls, and files you share.',
        'Emergency and medical info, if you or your guardian add it: allergies, conditions, medications, insurance, notes, and emergency contacts.',
        'Payments: what your team asked you to pay and whether it is paid. Card and bank details go directly to Stripe and never reach our servers.',
        'Devices: a notification token for each phone or browser where you turn on notifications, and the private link for your calendar feed if you create one.',
        'Service logs: requests to our servers, including IP address, kept to keep the service working and to stop abuse.',
      ],
    },
    {
      title: 'How we use it',
      body: [
        'We use your information to run GamePlan for you and your teams: to show schedules and chats, send the reminders and notifications you asked for, collect team dues, and keep accounts secure. We do not use it for anything else.',
      ],
    },
    {
      title: 'Who can see it',
      body: [],
      bullets: [
        'Teammates on a team you share see your name, photo, phone number, roles, positions, RSVPs, and the messages you send in that team’s chats.',
        'Team staff who have the medical permission can see the emergency and medical info of people on their team. Each time they open it, the team keeps a record of who looked and when, for one year.',
        'Guardians linked to a minor can see and edit that minor’s emergency info, and act for them on their teams.',
        'Organization admins can manage the teams in their organization.',
        'When two clubs share a game, staff of both clubs share a chat about that game.',
      ],
    },
    {
      title: 'Service providers',
      body: ['These companies process information for us, only to provide their part of the service:'],
      bullets: [
        'Amazon Web Services: hosting, storage, and sign-in (Amazon Cognito), in the United States.',
        'Stripe: team dues, payouts to teams, and team and club plans.',
        'Google Maps: address search and maps for event locations.',
        'Apple and Google: sign-in, if you choose it, and delivery of notifications to phones.',
        'Expo: passes notifications from our servers to Apple and Google.',
        'Your browser’s push service, if you turn on notifications on the website.',
      ],
    },
    {
      title: 'Children and teens',
      body: [
        'GamePlan is for organized teams, and many players are under 18. An account with a birthday under 18 is a minor account. Minors cannot create teams or become team admins, and an adult can be linked as their guardian. Guardians manage a minor’s emergency info and can act for them on their teams.',
        'GamePlan is not directed at young children. If you are a parent or guardian and believe a child has given us information without your permission, contact us and we will delete it.',
      ],
    },
    {
      title: 'Deleting your account',
      body: [
        'You can delete your account at any time: open Profile, choose Delete account, and confirm. This works in the apps and on the website. Deletion removes your sign-in, profile and photo, emergency and medical info, settings, devices, calendar feed, and your memberships in every team, chat, and organization, and unlinks you from any guardian or child.',
        'Messages you sent, past RSVPs, and a team’s record of dues stay with that team, without your profile, because they are part of the team’s history. A free team with nobody else on it is deleted with its schedule and chats. If you own an organization, or are the only admin of a team that still has members or a paid plan, you are asked to hand it over first.',
        'Server logs are kept for 30 days and then deleted.',
      ],
    },
    {
      title: 'Your choices',
      body: [
        'You can change your profile, phone number, and emergency info in the app, turn notifications on or off in your device or browser settings, and reset or stop using your calendar link. You can ask us for a copy of your information, or to correct it, by contacting us.',
      ],
    },
    {
      title: 'Security',
      body: [
        'Information is encrypted in transit and at rest. On phones your session is kept in the device’s secure storage, and on the website in a cookie that page scripts cannot read. Access inside teams follows the roles and permissions each team sets.',
      ],
    },
    {
      title: 'Changes to this policy',
      body: [
        'When this policy changes, we update the date at the top. If a change affects how we use information you have already given us, we will tell you in the app before it takes effect.',
      ],
    },
  ],
  contact: 'Questions or requests about your privacy: {{email}}',
};

const es: Policy = {
  title: 'Política de privacidad',
  updatedLabel: 'Última actualización',
  intro:
    'GamePlan ayuda a los equipos a organizar una temporada: calendarios, asistencia, chat, cuotas e información de emergencia. Esta política explica qué recopilamos, por qué, quién puede verlo y cómo eliminarlo. Se aplica al sitio web de GamePlan y a las apps para iOS y Android.',
  sections: [
    {
      title: 'Lo que no hacemos',
      body: [],
      bullets: [
        'No vendemos tu información ni la compartimos para publicidad.',
        'No mostramos anuncios y no usamos herramientas de analítica, publicidad ni seguimiento en las apps ni en el sitio web.',
        'No leemos la ubicación de tu dispositivo. Las direcciones de los eventos las escribe el personal del equipo.',
      ],
    },
    {
      title: 'Qué recopilamos',
      body: ['Solo recopilamos lo que tú, tu equipo o tu tutor ingresan, y lo necesario para que el servicio funcione.'],
      bullets: [
        'Cuenta: tu correo electrónico, nombre visible y fecha de nacimiento. Tu contraseña la guarda Amazon Cognito, nuestro servicio de inicio de sesión, y nunca la vemos. Si continúas con Apple o Google, ellos nos comparten tu nombre y correo.',
        'Perfil: una foto y un número de teléfono, si los agregas, y las posiciones en las que juegas.',
        'Actividad del equipo: los equipos a los que perteneces y tus roles, eventos, asistencia, alineaciones, viajes compartidos, voluntariados, mensajes de chat, encuestas y archivos que compartes.',
        'Información médica y de emergencia, si tú o tu tutor la agregan: alergias, condiciones, medicamentos, seguro, notas y contactos de emergencia.',
        'Pagos: lo que tu equipo te pidió pagar y si está pagado. Los datos de tarjeta y banco van directamente a Stripe y nunca llegan a nuestros servidores.',
        'Dispositivos: un identificador de notificaciones por cada teléfono o navegador donde las actives, y el enlace privado de tu calendario si lo creas.',
        'Registros del servicio: las solicitudes a nuestros servidores, incluida la dirección IP, para mantener el servicio funcionando y evitar abusos.',
      ],
    },
    {
      title: 'Cómo la usamos',
      body: [
        'Usamos tu información para que GamePlan funcione para ti y tus equipos: mostrar calendarios y chats, enviar los recordatorios y notificaciones que pediste, cobrar cuotas del equipo y mantener las cuentas seguras. No la usamos para nada más.',
      ],
    },
    {
      title: 'Quién puede verla',
      body: [],
      bullets: [
        'Los compañeros de un equipo que compartes ven tu nombre, foto, teléfono, roles, posiciones, asistencia y los mensajes que envías en los chats de ese equipo.',
        'El personal del equipo con el permiso médico puede ver la información médica y de emergencia de las personas de su equipo. Cada vez que la abren, el equipo guarda un registro de quién la vio y cuándo, durante un año.',
        'Los tutores vinculados a un menor pueden ver y editar su información de emergencia, y actuar por él en sus equipos.',
        'Los administradores de una organización pueden gestionar los equipos de su organización.',
        'Cuando dos clubes comparten un partido, el personal de ambos clubes comparte un chat sobre ese partido.',
      ],
    },
    {
      title: 'Proveedores de servicios',
      body: ['Estas empresas procesan información por nosotros, solo para prestar su parte del servicio:'],
      bullets: [
        'Amazon Web Services: alojamiento, almacenamiento e inicio de sesión (Amazon Cognito), en Estados Unidos.',
        'Stripe: cuotas del equipo, pagos a los equipos y planes de equipos y clubes.',
        'Google Maps: búsqueda de direcciones y mapas de los lugares de los eventos.',
        'Apple y Google: inicio de sesión, si lo eliges, y entrega de notificaciones a los teléfonos.',
        'Expo: transmite las notificaciones de nuestros servidores a Apple y Google.',
        'El servicio de notificaciones de tu navegador, si activas las notificaciones en el sitio web.',
      ],
    },
    {
      title: 'Niños y adolescentes',
      body: [
        'GamePlan es para equipos organizados, y muchos jugadores tienen menos de 18 años. Una cuenta con fecha de nacimiento de menos de 18 años es una cuenta de menor. Los menores no pueden crear equipos ni ser administradores, y un adulto puede vincularse como su tutor. Los tutores gestionan la información de emergencia del menor y pueden actuar por él en sus equipos.',
        'GamePlan no está dirigido a niños pequeños. Si eres padre, madre o tutor y crees que un niño nos dio información sin tu permiso, contáctanos y la eliminaremos.',
      ],
    },
    {
      title: 'Eliminar tu cuenta',
      body: [
        'Puedes eliminar tu cuenta en cualquier momento: abre Perfil, elige Eliminar cuenta y confirma. Funciona en las apps y en el sitio web. Se eliminan tu inicio de sesión, perfil y foto, información médica y de emergencia, ajustes, dispositivos, calendario y tu pertenencia a todos los equipos, chats y organizaciones, y se quitan tus vínculos de tutor o de hijo.',
        'Los mensajes que enviaste, tu asistencia pasada y el registro de cuotas de un equipo se quedan con ese equipo, sin tu perfil, porque son parte de su historia. Un equipo gratuito sin nadie más se elimina con su calendario y sus chats. Si eres dueño de una organización, o el único administrador de un equipo que todavía tiene miembros o un plan pagado, te pediremos que lo entregues primero.',
        'Los registros del servidor se guardan 30 días y luego se eliminan.',
      ],
    },
    {
      title: 'Tus opciones',
      body: [
        'Puedes cambiar tu perfil, teléfono e información de emergencia en la app, activar o desactivar las notificaciones en los ajustes de tu dispositivo o navegador, y restablecer o dejar de usar el enlace de tu calendario. Puedes pedirnos una copia de tu información, o que la corrijamos, contactándonos.',
      ],
    },
    {
      title: 'Seguridad',
      body: [
        'La información se cifra en tránsito y en reposo. En los teléfonos tu sesión se guarda en el almacenamiento seguro del dispositivo, y en el sitio web en una cookie que los scripts de la página no pueden leer. El acceso dentro de cada equipo sigue los roles y permisos que el equipo define.',
      ],
    },
    {
      title: 'Cambios a esta política',
      body: [
        'Cuando esta política cambie, actualizaremos la fecha de arriba. Si un cambio afecta cómo usamos información que ya nos diste, te avisaremos en la app antes de que entre en vigor.',
      ],
    },
  ],
  contact: 'Preguntas o solicitudes sobre tu privacidad: {{email}}',
};

/** The policy for each app language. */
export const PRIVACY_POLICY: Record<AppLang, Policy> = { en, es };

/**
 * The policy in a language, falling back to English.
 *
 * @param language - An i18next language such as `es` or `es-MX`.
 * @returns The policy.
 */
export const policyFor = (language: string): Policy =>
  PRIVACY_POLICY[language.split('-')[0] === 'es' ? 'es' : 'en'];

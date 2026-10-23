# GamePlan features

What GamePlan offers each group it is sold to. Plan prices and the role permission matrix are described in [ARCHITECTURE.md](ARCHITECTURE.md#plans-and-entitlements).

## Who it is for

| User base | Who they are | What they want from GamePlan |
| --- | --- | --- |
| **Team admins and coaches** | The adult who creates the team, plus coaches and staff granted permissions | Run the schedule, the roster, chat, and money from one place |
| **Players** | Adult athletes (rec and club teams) and minor athletes | Know where to be, say if they are coming, and talk to the team |
| **Parents and guardians** | Adults linked to one or more minors | See every child's schedule, handle rides and volunteering, pay dues, keep medical info current |
| **Clubs and leagues** | Organizations running many teams | Manage and pay for every team together and talk to all of them at once |

## Feature table

✅ uses the feature · 🛠️ manages or configures it · — not applicable

Staff powers come from the team's permission matrix. A team admin can give any permission to any role.

### Team and roster

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Create a team with sport, time zone, colors, logo, and chat wallpaper | 🛠️ | — | — | ✅ | Free |
| Invite links per role, shareable as a link | 🛠️ | ✅ | ✅ | — | Free |
| Team directory search and join requests with approval | 🛠️ | ✅ | ✅ | ✅ | Free |
| Role permission matrix (10 permissions across admin, coach, player, parent) | 🛠️ | — | — | ✅ | Free |
| Player positions | 🛠️ | ✅ | — | — | Free |

### Schedule

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Practices, games, meetings, and other events, each with its own color | 🛠️ | ✅ | ✅ | ✅ | Free |
| Recurring series on the team's local time, with single-date edits and cancellations | 🛠️ | ✅ | ✅ | — | Free |
| Venue search and maps | 🛠️ | ✅ | ✅ | — | Free |
| RSVPs (going, maybe, not going) | ✅ | ✅ | ✅ | — | Free |
| Game lineups | 🛠️ | ✅ | ✅ | — | Free |
| Carpools: offer seats, claim seats, carpool chat | ✅ | ✅ | ✅ | — | Free |
| Volunteer sign-ups ("Snacks, 1", "Drivers, 3") | 🛠️ | ✅ | ✅ | — | Free |
| Shared games with an opposing club, kept in sync, with a staff thread between the clubs | 🛠️ | ✅ | ✅ | — | Free |
| Reminders, with the evening-before and lead time chosen by each person | ✅ | ✅ | ✅ | — | Free |
| Private calendar feed for Google, Apple, and Outlook, including children's teams | ✅ | ✅ | ✅ | — | Free |

### Chat

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Team chat, live on every device | ✅ | ✅ | ✅ | — | Free |
| Channels inside a team | 🛠️ | ✅ | ✅ | — | Free |
| Private messages | ✅ | ✅ | ✅ | — | Free |
| Photo attachments | ✅ | ✅ | ✅ | — | Free |
| Polls with multiple answers and a closing time | 🛠️ | ✅ | ✅ | — | Free |
| Push notifications on web, iOS, and Android | ✅ | ✅ | ✅ | ✅ | Free |

### Family and safety

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Guardian links between adults and minors | — | ✅ | 🛠️ | — | Free |
| Emergency and medical info, kept once per person for every team | — | ✅ | 🛠️ | — | Free (always) |
| Staff read access to medical info, with every read logged | ✅ | — | — | — | Free |
| People search returns adults only, so minors cannot be found by email | — | ✅ | ✅ | — | Free |

### Money

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Team dues through the team's own Stripe account (cards, Apple Pay, Google Pay) | 🛠️ | ✅ | ✅ | — | Free (2% platform fee) |
| Mark dues paid outside the app or waived | 🛠️ | — | — | — | Free |
| Automatic due-date reminders | ✅ | ✅ | ✅ | — | Free |
| Guardians pay a minor's dues | — | — | ✅ | — | Free |
| Team plan billing: checkout, cards, invoices, cancellation | 🛠️ | — | — | — | Premium |

### Organizations

| Feature | Admins and coaches | Players | Parents and guardians | Clubs and leagues | Plan |
| --- | :---: | :---: | :---: | :---: | --- |
| Create an organization and add admins | — | — | — | 🛠️ | Free |
| Invite teams; the team's billing manager accepts | ✅ | — | — | 🛠️ | Free |
| Organization admins act as admins on every member team | — | — | — | ✅ | Free |
| Announcements posted to every team's chat | — | ✅ | ✅ | 🛠️ | Organization |
| One subscription for every team (5 included, $5/month per extra) | — | — | — | 🛠️ | Organization |

### Platform

| Feature | Notes |
| --- | --- |
| Website, iOS, and Android | One app; the website installs to the Home Screen |
| Sign-in | Email and password, Google, Apple, Facebook |
| Languages | English and Spanish, chosen from the device |

## Plans

| | Free | Premium | Organization |
| --- | --- | --- | --- |
| Price | $0 | $9/month or $90/year, per team | $35/month or $350/year |
| Sold to | Every team | One team | Clubs and leagues |
| Everything above marked Free | ✅ | ✅ | ✅ on every team |
| Ads for adults | Yes | No | No |
| Photo storage | 2 GB | 50 GB with video | 50 GB with video |
| Organization admins and announcements | — | — | ✅ |

## Advertised but not built yet

The plans screen ([en.json](client/expo/src/en.json)) lists these, and limits for them are in `PLAN_LIMITS` ([lib/rules](lib/rules/src/index.ts)), but no route or screen exists yet.

| Feature | Tier | Main audience |
| --- | --- | --- |
| Team videos (up to 1 GB, 10 minutes each) | Premium, Organization | Coaches, players, parents |
| Album storage limits (2 GB / 50 GB) are defined but not checked on upload | All | Everyone |
| Practice plans (5 on Free, unlimited on paid) | All | Coaches |
| Digital waivers | Premium, Organization | Admins, parents |
| AI coach assistant (200 or 1,000 requests a month) | Premium, Organization | Coaches |
| Shared practice library and waiver templates | Organization | Clubs and leagues |
| Organization dashboard | Organization | Clubs and leagues |
| Parent add-on (no ads, full-quality downloads) through in-app purchase | Per person | Parents |
| Ads for adults on free teams | Free | — |

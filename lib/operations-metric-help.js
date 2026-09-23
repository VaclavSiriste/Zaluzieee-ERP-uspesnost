/**
 * Popisy výpočtu metrik na stránkách řízení provozu (tooltip u „!“).
 */

export const OPERATIONS_METRIC_HELP = {
  sla_celkem: `SLA celkem = (zvednuté do 20 s) / (všechny zvednuté) × 100 %.
Zdroj: Daktela · tabulka call, direction = IN, fronta označená „SLA“ u dané značky.
Čekání: COALESCE(wait_time, ringing_time) v sekundách. Prah: 20 s.
Období: podle filtru (Europe/Prague).`,

  sla_total_incoming: `Počet příchozích hovorů (call.direction = IN) ve frontách dané značky ve zvoleném období.
Zdroj: Daktela · call + queue.`,

  sla_answered: `Zvednuté hovory: call.answered = true.
Jen příchozí (IN) ve filtrovaných frontách a období.`,

  sla_20s: `Hovory se SLA splněno: zvednuté a COALESCE(wait_time, ringing_time) ≤ 20 s.
Stejný jmenovatel jako u SLA celkem (%).`,

  sla_interval_0_20: `Zvednuté hovory s čekáním 0–20 s (včetně). Shodné s počtem „do 20 s (SLA)“.`,

  sla_interval_21_40: `Zvednuté hovory s čekáním 21–40 s (wait_time nebo ringing_time).`,

  sla_interval_41_60: `Zvednuté hovory s čekáním 41–60 s.`,

  sla_interval_60_plus: `Zvednuté hovory s čekáním nad 60 s.`,

  sla_missed: `Nezvednuté / zmeškané: call.answered není true (příchozí IN ve filtru).`,

  sla_avg_response: `Průměrné čekání u zvednutých hovorů: AVG(COALESCE(wait_time, ringing_time)) v sekundách.`,

  sla_queue_fronty: `Rozpad podle front Daktela (queue.title / queue ID). Počítají se všechny hovory ve frontě (IN i OUT) ve zvoleném období. Fronty s 0 hovory se neukazují.`,

  sla_queue_calls: `Hovory: celkový počet záznamů v call pro danou frontu a období filtru.`,

  sla_queue_answered: `Zvednuté: call.answered = true (všechny směry ve frontě).`,

  sla_queue_unanswered: `Nezvednuté: call.answered není true.`,

  sla_queue_sla_badge: `Badge „SLA“ u fronty znamená, že fronta se počítá do souhrnného SLA celkem (hlavní IN fronta značky). Ostatní fronty jsou jen informativní rozpad.`,

  sla_queue_totals: `Součet hovorů, zvednutých a nezvednutých přes všechny zobrazené fronty v rozpadu (fronty s 0 hovory v období se neukazují).`,

  sla_working_hours: `Počet příchozích hovorů (direction = IN) na linkách dané značky v pracovní době (Europe/Prague).
Výchozí: Po–Pá 8:00–20:00, So–Ne 10:00–18:00.
pokladamee: Po–Pá 8:00–16:00 (víkendy = mimo).
U front v rozpadu se počítají hovory ve frontě (IN i OUT) ve stejných hodinách.`,

  sla_outside_hours: `Počet hovorů mimo pracovní dobu — stejný filtr linek, čas mimo pracovní profil značky.`,

  sla_working_hours_missed: `Zmeškané příchozí (answered ≠ true) v pracovní době značky. Stejné linky a stejný profil hodin jako u „Hovory · pracovní doba“.`,

  sla_outside_hours_missed: `Zmeškané příchozí mimo pracovní dobu značky.`,

  navolani_celkem: `Úspěšnost navolání = (Dopadl hovor ANO) / (Dopadl hovor ANO + NE) × 100 %.
Zdroj: ERP Systeeem · orders.organization_id dle značky.
Období: datum navolání (slug datum_navolani v orders_column_values).
Vyloučeno: status duplikace.
Sheet značky (pokladamee / malujemeee): Google Sheet OVT · ANO ve sloupci L / (ANO + NE) · filtr sloupec K (datum navolání).
pokladamee: řádky s důvodem ve sloupci M „Důvod ne Hovoru“ (Mimo dosah, Duplikace, nemožná realizace, zájem o spolupráci, žádost o práci — bez diakritiky / varianty) se z úspěšnosti úplně vyřazují.`,

  navolani_zamereni_ano: `Počet zakázek s hodnotou ANO u sloupce naplanovan_termin_zamereni (orders_column_values, slug naplanovan_termin_zamereni).
Operátor: assignment_type kdo_naplanoval_zamereni.`,

  navolani_dopadl_ano: `Počet zakázek s hodnotou ANO u sloupce dopadl_hovor (slug dopadl_hovor).
Operátor: assignment_type domluvil_zamereni. Čitatel úspěšnosti navolání.`,

  navolani_zamereni_ne: `Zakázky s naplanovan_termin_zamereni = NE (komunikováno, termín ne).`,

  navolani_dopadl_ne: `Zakázky s dopadl_hovor = NE. Společně s ANO tvoří jmenovatel úspěšnosti navolání.`,

  navolani_operator: `Úspěšnost operátora = jeho Dopadl hovor ANO / (ANO + NE) × 100 %.
Stejná logika ERP jako u souhrnu, filtr podle jména operátora.`,

  targets_celkem: `Plnění targetu = Splněno / Cíl × 100 % (za zvolený kalendářní měsíc).
Cíl: ručně zadaný „Cíl celkem“.
Splněno: počet záznamů s vyplněným datumem zaměření v měsíci (ERP; u pokladamee Google Sheet sloupec P).`,

  targets_cil_celkem: `Cíl celkem (kolik): ručně zadaná hodnota pro měsíc a značku — kolik zaměření chcete v měsíci naplánovat.`,

  targets_splneno_celkem: `Splněno celkem: počet záznamů s vyplněným datumem zaměření ve zvoleném měsíci.
ERP: organization_id značky, bez duplikace. pokladamee: Google Sheet sloupec P (Datum zaměření).`,

  targets_technik: `Cíl: ručně zadaný target pro technika (zaměřovače).
Splněno: ERP — assignment_type zamerovac + datum_zamereni v měsíci.
pokladamee: jména ze sloupce Q (OVT), Splněno = počet řádků se sloupcem P (Datum zaměření) v měsíci u daného jména.`,

  targets_kraj: `Cíl: ručně zadaný target pro kraj.
Splněno: ERP — customers.region + datum_zamereni.
pokladamee: sloupec U (Kraj) + sloupec P (Datum zaměření) ve zvoleném měsíci.`,

  filter_obdobi: `Období filtru platí pro SLA příchozích linek (Daktela), Výčet SLA (ERP / OVT sheet dle značky), úspěšnost navolání, průměrnou dobu do navolání zmeškaných i dobu do reakce trasovače (vstup do fronty). U sheetu poptávky = datum přijetí leadu (B). Vlastní datum = celé kalendářní dny Europe/Prague. Targety používají kalendářní měsíc zvlášť. Počet „Čeká na trasovače“ je aktuální snapshot.`,

  vycet_sla_celkem: `Výčet SLA = navoláno / přišlo × 100 %.
ERP: business den (created_at +2h, po 20:00 → další den) · first_iframe_change_at · organization_id.
OVT sheet (pokladamee / malujemeee): filtr období na B (datum přijetí) · A=ID · K=datum navolání.
Navoláno (sheet) = K ve stejný kalendářní den jako B. SLA 24·48·72 = K do N hodin od B.`,

  vycet_sla_leads: `ERP: počet leadů s business datem ve filtru.
Sheet: leady s ID (A) a datem přijetí (B) ve filtru období.`,

  vycet_sla_navolano: `ERP: lead navolán ve stejný business den (first_iframe_change_at).
Sheet: ve filtru má K (= datum navolání) stejný den jako B.`,

  vycet_sla_missing: `Přišlo leadů minus navoláno ve stejný den.
Sheet: B ve filtru a K chybí nebo je jiný den než B.`,

  vycet_sla_poptavky: `ERP: poptávky dle kalendářního data (created_at + 2 h) + filtry status/formulář.
Sheet: ID (A) + datum přijetí (B) ve filtru; u pokladamee vyloučeny důvody M (mimodosah, duplikace, …).`,

  vycet_sla_24: `SLA 24: kontakt do 24 h od vzniku leadu. % = SLA 24 / poptávky.
Sheet: (K − B) ve dnech × 24 ≤ 24.`,

  vycet_sla_48: `SLA 48: kontakt do 48 h. % = SLA 48 / poptávky.
Sheet: rozdíl B→K ≤ 48 h (po dnech).`,

  vycet_sla_72: `SLA 72: kontakt do 72 h. % = SLA 72 / poptávky.
Sheet: rozdíl B→K ≤ 72 h (po dnech).`,

  missed_callback_avg: `Průměrná doba do navolání = průměr (čas vyřízení − čas zmeškaného) u vyřízených čísel.
Zmeškaný = call.direction = IN, answered = false, fronty dané značky.
Vyřízení = dřívější z:
• první pozdější odchozí (OUT) na stejné číslo (posledních 9 číslic clid), nebo
• první pozdější zvednutý příchozí (IN answered) od stejného čísla (zákazník zavolá znovu).
Pracovní doba dle značky (Europe/Prague, čas zmeškaného hovoru):
• výchozí: Po–Pá 8:00–20:00, So–Ne 10:00–18:00
• pokladamee: Po–Pá 8:00–16:00 (víkendy = mimo)
Jednotka: hodiny. Období: stejný filtr jako ostatní metriky.`,

  missed_callback_working: `Průměr do navolání jen pro zmeškané hovory v pracovní době značky (u pokladamee Po–Pá 8–16).`,

  missed_callback_outside: `Průměr do navolání jen pro zmeškané hovory mimo pracovní dobu značky.`,

  trasovac_waiting: `Počet leadů aktuálně ve stavu „Čeká na trasovače“ (slug ceka-na-trasovace).
Zdroj: ERP Systeeem · orders.status · organization_id značky.
Snapshot — nezávisí na filtru období.`,

  trasovac_avg: `Průměrná doba do reakce trasovače.
Start: orders_audit_log · změna statusu → ceka-na-trasovace (created_at).
Konec: první jakákoli další změna v logu stejné zakázky nejdříve 15 minut po startu
(jakékoli pole / status — včetně „nedovoláno“; grace 15 min odfiltruje doplňování polí navoláčem).
Období filtru: podle data vstupu do fronty (entered_at).
Jednotka: hodiny.`,

  trasovac_median: `Medián stejné doby jako u průměru (vstup do „čeká na trasovače“ → první změna v logu ≥ 15 min).
Stejný vzorek leadů s reakcí ve filtru období.`
}

export function getOperationsMetricHelp(helpId) {
  return OPERATIONS_METRIC_HELP[helpId] || ''
}

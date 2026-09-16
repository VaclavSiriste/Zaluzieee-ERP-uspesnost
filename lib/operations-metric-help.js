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

  navolani_celkem: `Úspěšnost navolání = (Naplánován termín zaměření ANO) / (Dopadl hovor ANO) × 100 %.
Zdroj: ERP Systeeem · orders.organization_id dle značky.
Období: datum navolání (slug datum_navolani v orders_column_values).
Vyloučeno: status duplikace.
Výjimka pokladamee: Google Sheet (gid 1262379590) · ANO ve sloupci L / počet řádků · filtr sloupec K (datum navolání).`,

  navolani_zamereni_ano: `Počet zakázek s hodnotou ANO u sloupce naplanovan_termin_zamereni (orders_column_values, slug naplanovan_termin_zamereni).
Operátor: assignment_type kdo_naplanoval_zamereni. Čítač úspěšnosti navolání.`,

  navolani_dopadl_ano: `Počet zakázek s hodnotou ANO u sloupce dopadl_hovor (slug dopadl_hovor).
Operátor: assignment_type domluvil_zamereni. Jmenovatel úspěšnosti navolání.`,

  navolani_zamereni_ne: `Zakázky s naplanovan_termin_zamereni = NE (komunikováno, termín ne).`,

  navolani_dopadl_ne: `Zakázky s dopadl_hovor = NE.`,

  navolani_operator: `Úspěšnost operátora = jeho termín zaměření ANO / jeho dopadl hovor ANO × 100 %.
Stejná logika ERP jako u souhrnu, filtr podle jména operátora.`,

  targets_celkem: `Plnění targetu = Splněno / Cíl × 100 % (za zvolený kalendářní měsíc).
Cíl: ručně zadaný „Cíl celkem“.
Splněno: počet zakázek s datum_zamereni v měsíci (ERP), bez duplikace, dle organizace značky.`,

  targets_cil_celkem: `Cíl celkem (kolik): ručně zadaná hodnota pro měsíc a značku — kolik zaměření chcete v měsíci naplánovat.`,

  targets_splneno_celkem: `Splněno celkem: automaticky z ERP = počet zakázek s vyplněným datum_zamereni ve zvoleném měsíci.
Filtr: organization_id značky, bez statusu duplikace. Není součet techniků/krajů.`,

  targets_technik: `Cíl: ručně zadaný target pro technika (zaměřovače).
Splněno: z ERP — počet zakázek se zaměřením v měsíci, přiřazení assignment_type zamerovac.`,

  targets_kraj: `Cíl: ručně zadaný target pro kraj.
Splněno: z ERP — počet zaměření v měsíci podle customers.region u zakázky.`,

  filter_obdobi: `Období filtru platí pro SLA (Daktela), úspěšnost navolání (ERP) i průměrnou dobu do navolání zmeškaných. Vlastní datum = celé kalendářní dny v časové zóně Europe/Prague. Targety používají kalendářní měsíc zvlášť.`,

  missed_callback_avg: `Průměrná doba do navolání = průměr (čas prvního odchozího hovoru − čas zmeškaného příchozího) u navolaných čísel.
Zmeškaný = call.direction = IN, answered = false, fronty dané značky.
Navolání = první pozdější odchozí hovor (OUT) na stejné číslo (posledních 9 číslic clid).
Jednotka: hodiny (příp. minuty / dny). Období: stejný filtr jako ostatní metriky.`
}

export function getOperationsMetricHelp(helpId) {
  return OPERATIONS_METRIC_HELP[helpId] || ''
}

/**
 * Metriky - Modul pro výpočet a sledování webových metrik
 * 
 * Funkce:
 * - Sleduje počet návštěv
 * - Měří čas strávený na stránce
 * - Počítá počet kliknutí
 * - Vypočítava průměrný reakční čas
 * - Ukládá data v localStorage
 */

class MetricsCalculator {
    constructor() {
        this.metrics = {
            visits: 0,
            timeStarted: Date.now(),
            timeSpent: 0,
            clicks: 0,
            responseTime: [],
            lastUpdated: null
        };
        
        this.loadMetrics();
        this.initializeTracking();
    }

    /**
     * Načte uložené metriky z localStorage
     */
    loadMetrics() {
        const stored = localStorage.getItem('pageMetrics');
        if (stored) {
            try {
                this.metrics = JSON.parse(stored);
            } catch (e) {
                console.error('Chyba při načítání metrik:', e);
                this.resetMetrics();
            }
        } else {
            this.metrics.visits = 1;
            this.metrics.timeStarted = Date.now();
        }
    }

    /**
     * Inicializuje sledování událostí na stránce
     */
    initializeTracking() {
        // Sleduje kliknutí
        document.addEventListener('click', (e) => this.trackClick(e));

        // Aktualizuje čas strávený na stránce každou sekundu
        setInterval(() => {
            this.updateTimeSpent();
            this.saveMetrics();
            this.updateUI();
        }, 1000);

        // Zvýší počet návštěv při obnovení stránky
        window.addEventListener('beforeunload', () => {
            this.metrics.visits++;
            this.saveMetrics();
        });

        // Měří reakční časy
        this.measureResponseTimes();

        // Počáteční aktualizace UI
        this.updateUI();
    }

    /**
     * Sleduje jednotlivá kliknutí
     * @param {Event} event - Objekt události kliknutí
     */
    trackClick(event) {
        const startTime = performance.now();
        
        this.metrics.clicks++;

        // Simulace reakčního času (měření času do dalšího framu)
        requestAnimationFrame(() => {
            const responseTime = performance.now() - startTime;
            this.metrics.responseTime.push(responseTime);

            // Uchova pouze posledních 100 měření
            if (this.metrics.responseTime.length > 100) {
                this.metrics.responseTime.shift();
            }
        });
    }

    /**
     * Měří reakční časy stránky
     */
    measureResponseTimes() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;
            const pageLoadTime = timing.loadEventEnd - timing.navigationStart;
            
            if (pageLoadTime > 0) {
                this.metrics.responseTime.push(pageLoadTime);
            }
        }
    }

    /**
     * Aktualizuje čas strávený na stránce
     */
    updateTimeSpent() {
        const now = Date.now();
        this.metrics.timeSpent = Math.floor((now - this.metrics.timeStarted) / 1000);
        this.metrics.lastUpdated = now;
    }

    /**
     * Vypočítá průměrný reakční čas
     * @returns {number} - Průměrný reakční čas v ms
     */
    calculateAverageResponseTime() {
        if (this.metrics.responseTime.length === 0) return 0;
        
        const sum = this.metrics.responseTime.reduce((a, b) => a + b, 0);
        return (sum / this.metrics.responseTime.length).toFixed(2);
    }

    /**
     * Uloží metriky do localStorage
     */
    saveMetrics() {
        try {
            localStorage.setItem('pageMetrics', JSON.stringify(this.metrics));
        } catch (e) {
            console.error('Chyba při ukládání metrik:', e);
        }
    }

    /**
     * Aktualizuje uživatelské rozhraní s aktuálními metrikami
     */
    updateUI() {
        const visitCount = document.getElementById('visitCount');
        const timeSpent = document.getElementById('timeSpent');
        const clickCount = document.getElementById('clickCount');
        const avgResponseTime = document.getElementById('avgResponseTime');

        if (visitCount) visitCount.textContent = this.metrics.visits;
        if (timeSpent) timeSpent.textContent = this.formatTime(this.metrics.timeSpent);
        if (clickCount) clickCount.textContent = this.metrics.clicks;
        if (avgResponseTime) {
            avgResponseTime.textContent = this.calculateAverageResponseTime() + 'ms';
        }
    }

    /**
     * Formátuje čas do čitelného formátu
     * @param {number} seconds - Čas v sekundách
     * @returns {string} - Formátovaný čas
     */
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }

    /**
     * Resetuje všechny metriky
     */
    reset() {
        if (confirm('Opravdu chcete resetovat všechny metriky?')) {
            this.metrics = {
                visits: 1,
                timeStarted: Date.now(),
                timeSpent: 0,
                clicks: 0,
                responseTime: [],
                lastUpdated: null
            };
            this.saveMetrics();
            this.updateUI();
            console.log('Metriky resetovány');
        }
    }

    /**
     * Exportuje metriky jako JSON
     */
    export() {
        const dataStr = JSON.stringify(this.metrics, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `metriky-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log('Metriky exportovány');
    }

    /**
     * Vrací oblíbené informace o metrikách
     */
    getReport() {
        return {
            'Počet návštěv': this.metrics.visits,
            'Čas na stránce': this.formatTime(this.metrics.timeSpent),
            'Celkový počet kliknutí': this.metrics.clicks,
            'Průměrný reakční čas': this.calculateAverageResponseTime() + 'ms',
            'Generováno': new Date().toLocaleString('cs-CZ')
        };
    }
}

// Inicializace metriky při načtení stránky
let metricsCalculator;

document.addEventListener('DOMContentLoaded', () => {
    metricsCalculator = new MetricsCalculator();
    console.log('Metriky inicializovány');
});

/**
 * Veřejná funkce - Sleduje Custom akci
 */
function trackEvent() {
    if (metricsCalculator) {
        const report = metricsCalculator.getReport();
        console.log('📊 Zpráva o metrikách:', report);
        alert('Akce sledována!\n\n' + JSON.stringify(report, null, 2));
    }
}

/**
 * Veřejná funkce - Resetuje metriky
 */
function resetMetrics() {
    if (metricsCalculator) {
        metricsCalculator.reset();
    }
}

/**
 * Veřejná funkce - Exportuje metriky
 */
function exportMetrics() {
    if (metricsCalculator) {
        metricsCalculator.export();
    }
}

// Export pro Node.js/CommonJS (pokud je potřeba)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetricsCalculator;
}

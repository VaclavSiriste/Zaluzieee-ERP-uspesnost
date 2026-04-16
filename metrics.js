// Tento soubor je generován z next.js
// Pro vývoj edituj next.js soubor

/**
 * Metriky - Modul pro výpočet a sledování webových metrik
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

    initializeTracking() {
        document.addEventListener('click', (e) => this.trackClick(e));

        setInterval(() => {
            this.updateTimeSpent();
            this.saveMetrics();
            this.updateUI();
        }, 1000);

        window.addEventListener('beforeunload', () => {
            this.metrics.visits++;
            this.saveMetrics();
        });

        this.measureResponseTimes();
        this.updateUI();
    }

    trackClick(event) {
        const startTime = performance.now();
        this.metrics.clicks++;

        requestAnimationFrame(() => {
            const responseTime = performance.now() - startTime;
            this.metrics.responseTime.push(responseTime);

            if (this.metrics.responseTime.length > 100) {
                this.metrics.responseTime.shift();
            }
        });
    }

    measureResponseTimes() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;
            const pageLoadTime = timing.loadEventEnd - timing.navigationStart;
            
            if (pageLoadTime > 0) {
                this.metrics.responseTime.push(pageLoadTime);
            }
        }
    }

    updateTimeSpent() {
        const now = Date.now();
        this.metrics.timeSpent = Math.floor((now - this.metrics.timeStarted) / 1000);
        this.metrics.lastUpdated = now;
    }

    calculateAverageResponseTime() {
        if (this.metrics.responseTime.length === 0) return 0;
        const sum = this.metrics.responseTime.reduce((a, b) => a + b, 0);
        return (sum / this.metrics.responseTime.length).toFixed(2);
    }

    saveMetrics() {
        try {
            localStorage.setItem('pageMetrics', JSON.stringify(this.metrics));
        } catch (e) {
            console.error('Chyba při ukládání metrik:', e);
        }
    }

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

let metricsCalculator;

document.addEventListener('DOMContentLoaded', () => {
    metricsCalculator = new MetricsCalculator();
    console.log('Metriky inicializovány');
});

function trackEvent() {
    if (metricsCalculator) {
        const report = metricsCalculator.getReport();
        console.log('📊 Zpráva o metrikách:', report);
        alert('Akce sledována!\n\n' + JSON.stringify(report, null, 2));
    }
}

function resetMetrics() {
    if (metricsCalculator) {
        metricsCalculator.reset();
    }
}

function exportMetrics() {
    if (metricsCalculator) {
        metricsCalculator.export();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetricsCalculator;
}

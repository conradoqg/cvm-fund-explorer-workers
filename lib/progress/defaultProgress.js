const ProgressReporter = require('./progressReporter');
const DatabaseOutput = require('./databaseOutput');
const ConsoleOutput = require('./consoleOutput');
const ProgressTracker = require('./progressTracker');
const ProgressLogger = require('./progressLogger');

const defaultTemplate = (progressTracker, prettyProgress) => {
    if (progressTracker.state.status == 'new')
        return `${progressTracker.id}: starting`;
    else if (progressTracker.state.status == 'running') {
        if (progressTracker.state.total != null) return `${progressTracker.id}: [${prettyProgress.state.percentageBar}] ${prettyProgress.state.current}/${prettyProgress.state.total} (${prettyProgress.state.percentage}%) - elapsed: ${prettyProgress.state.elapsed} - speed: ${prettyProgress.state.speed} - eta: ${prettyProgress.state.eta}`;
        else return `${progressTracker.id}: running`;
    } else if (progressTracker.state.status == 'ended') {
        if (progressTracker.state.total != null) return `${progressTracker.id}: took ${prettyProgress.state.elapsed} at ${prettyProgress.state.speed} for ${prettyProgress.state.current}`;
        else return `${progressTracker.id}: took ${prettyProgress.state.elapsed}`;
    } else if (progressTracker.state.status == 'errored') {
        if (progressTracker.state.total != null) return `${progressTracker.id}: failed at ${prettyProgress.state.current} after ${prettyProgress.state.elapsed}`;
        else return `${progressTracker.id}: failed after ${prettyProgress.state.elapsed}`;
    }
};

class DefaultProgress {
    consoleOutput = null;
    databaseOutput = null;
    progressTracker = null;
    progressReporter = null;
    progressLogger = null;    

    constructor(id, stepUnitConverter, template = defaultTemplate) {
        this.consoleOutput = new ConsoleOutput(template);
        this.databaseOutput = new DatabaseOutput();
        this.progressTracker = new ProgressTracker(id);
        this.progressReporter = new ProgressReporter(this.progressTracker, 2000, true, stepUnitConverter);
        this.progressLogger = new ProgressLogger(this.progressTracker);        
        this.progressReporter.addOutput(this.consoleOutput);        
        this.progressReporter.report(true);
    }
    start(total) {
        this.progressTracker.start(total);
        this.progressReporter.report(true);
    }
    step(stepAmount) {
        this.progressTracker.step(stepAmount);
        this.progressReporter.report();
    }
    set(current) {
        this.progressTracker.set(current);
        this.progressReporter.report();
    }
    log(text) {
        this.progressLogger.log(text);
    }
    end() {
        this.progressTracker.end();
        this.progressReporter.report(true);
    }
    error() {
        this.progressTracker.error();
        this.progressReporter.report(true);
    }

    immediate() {
        return new Promise(resolve => setImmediate(resolve));
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = DefaultProgress;

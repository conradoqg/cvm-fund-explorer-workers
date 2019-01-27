const Db = require('../../util/db');
const promisePipe = require('promisepipe');
const stream = require('stream');
const prettyMs = require('pretty-ms');
const convertHrtime = require('convert-hrtime');
const uuidv1 = require('uuid/v1');

const Worker = require('../worker');
const UI = require('../../util/ui');
const CONFIG = require('../../config');
const createInsertPromiseStream = require('../../stream/createInsertPromiseStream');
const createAccumulatorStream = require('../../stream/createAccumulatorStream');
const createWaitForPromisesStream = require('../../stream/createWaitForPromisesStream');

const createTotalProgressInfo = () => {
    return (progress) => `DataImprovementWorker Overall (${progress.total}): [${'▇'.repeat(progress.percentage) + '-'.repeat(100 - progress.percentage)}] ${progress.percentage.toFixed(2)}% - ${prettyMs(progress.elapsed)} - speed: ${progress.speed.toFixed(2)}r/s - eta: ${Number.isFinite(progress.eta) ? prettyMs(progress.eta) : 'Unknown'}`;
};

const createTotalFinishInfo = () => {
    return (progress) => `DataImprovementWorker Overall took ${prettyMs(progress.elapsed)} at ${progress.speed.toFixed(2)}r/s`;
};

class DataImprovementWorker extends Worker {
    constructor() {
        super();
    }

    async work() {
        try {

            const db = new Db();

            await db.takeOnline();

            try {
                const mainClient = await db.pool.connect();

                try {

                    const queryfundsCount = await mainClient.query('SELECT DISTINCT(cnpj_fundo), denom_social FROM inf_cadastral_fi');

                    const fundsCount = parseInt(queryfundsCount.rows.length);

                    const progressState = {
                        total: fundsCount,
                        start: process.hrtime(),
                        elapsed: 0,
                        finished: 0,
                        percentage: 0,
                        eta: 0,
                        speed: 0
                    };

                    const ui = new UI();
                    ui.start('total', 'Processing data', createTotalProgressInfo(fundsCount), createTotalFinishInfo());
                    ui.update('total', progressState);

                    const updateUI = () => {
                        progressState.elapsed = convertHrtime(process.hrtime(progressState.start)).milliseconds;
                        progressState.speed = progressState.finished / (progressState.elapsed / 100);
                        progressState.eta = ((progressState.elapsed * progressState.total) / progressState.finished) - progressState.elapsed;
                        progressState.percentage = (progressState.finished * 100) / progressState.total;
                        ui.update('total', progressState);
                    };

                    const updateUIProgressStream = stream.Transform({
                        objectMode: true,
                        highWaterMark: CONFIG.highWaterMark,
                        transform: (chunk, e, callback) => {
                            progressState.finished++;
                            updateUI();
                            callback(null, chunk);
                        },
                        flush: (callback) => {
                            updateUI();
                            callback();
                        }
                    });

                    const fundsStream = new stream.Readable({
                        objectMode: true,
                        highWaterMark: CONFIG.highWaterMark
                    });

                    const createDataImprovementStream = () => stream.Transform({
                        objectMode: true,
                        highWaterMark: CONFIG.highWaterMark,
                        transform: async (chunk, e, callback) => {
                            try {
                                const f_short_name = chunk.denom_social
                                    .replace(/(^| )(FUNDOS? DE INVESTIMENTO RENDA FIXA)( |$)/ig, '$1FIRF$3')
                                    .replace(/(^| )(FUNDOS? DE INVESTIMENTO (?:EM|DE)? (?:COTAS|QUOTAS))( |$)/ig, '$1FIC$3')
                                    .replace(/(^| )(FUNDOS? DE INVESTIMENTO MULTIMERCADO)( |$)/ig, '$1FIM$3')
                                    .replace(/(^| )(FUNDOS? DE INVESTIMENTO (?:EM|DE)? A[CÇ][OÕ]ES)( |$)/ig, '$1FIA$3')
                                    .replace(/(^| )(FI RENDA FIXA)( |$)/ig, '$1FIRF$3')
                                    .replace(/(^| )(FI MULTIMERCADO)( |$)/ig, '$1FIM$3')
                                    .replace(/(^| )(FI (?:EM|DE)? (?:COTAS|QUOTAS))( |$)/ig, '$1FIC$3')
                                    .replace(/(^| )(FI (?:EM|DE)? A[CÇ][OÕ]ES)( |$)/ig, '$1FIA$3')
                                    .replace(/(^| )(FUNDOS? DE INVESTIMENTO)( |$)/ig, '$1FI$3')
                                    .replace(/(^| )(RENDA FIXA)( |$)/ig, '$1RF$3')
                                    .replace(/(^| )(CR[ÉE]DITO PRIVADO)( |$)/ig, '$1CP$3')
                                    .replace(/(^| )(-)( |$)/ig, ' ')
                                    .replace(/(^| )(INVESTIMENTO NO EXTERIOR)( |$)/ig, '$1IE$3')
                                    .replace(/(^| )(LONGO PRAZO)( |$)/ig, '$1LP$3');

                                const data = {
                                    table: 'funds',
                                    primaryKey: ['f_cnpj'],
                                    fields: {
                                        f_id: uuidv1(),
                                        f_cnpj: chunk.cnpj_fundo,
                                        f_short_name,
                                        f_name: chunk.denom_social
                                    }
                                };                                
                                callback(null, data);
                            } catch (ex) {
                                console.error(ex);
                                callback(ex);
                            }
                        }
                    });

                    const dataImprovementPipe = promisePipe(
                        fundsStream,                        
                        updateUIProgressStream,                        
                        createDataImprovementStream(),
                        createAccumulatorStream(),
                        createInsertPromiseStream(db),                    
                        createWaitForPromisesStream()
                    );

                    queryfundsCount.rows.forEach(item => fundsStream.push(item));
                    fundsStream.push(null);

                    await dataImprovementPipe;

                    ui.stop('total');
                    ui.close();
                } catch (ex) {
                    throw ex;
                } finally {
                    mainClient.release();
                }
            } catch (ex) {
                throw ex;
            } finally {
                await db.takeOffline();
            }
        } catch (ex) {
            console.error(ex.stack);
        }
    }
}

module.exports = DataImprovementWorker;
const Db = require('../../util/db');
const prettyMs = require('pretty-ms');
const convertHrtime = require('convert-hrtime');
const got = require('got');
const stringSimilarity = require('string-similarity');
const allKeys = require('promise-results/allKeys');
const moment = require('moment');
const Worker = require('../worker');
const UI = require('../../util/ui');
const formatters = require('../../util/formatters');

const createProcessingProgressInfo = () => {
    return (progress) => `ModalMaisFundWorker: Processing data from Modal Mais of ${progress.total} funds: [${'▇'.repeat(progress.percentage / 2) + '-'.repeat(100 / 2 - progress.percentage / 2)}] ${progress.percentage.toFixed(2)}% - ${prettyMs(progress.elapsed)} - speed: ${progress.speed.toFixed(2)}r/s - eta: ${Number.isFinite(progress.eta) ? prettyMs(progress.eta) : 'Unknown'}`;
};

const createProcessingFinishInfo = () => {
    return (progress) => `ModalMaisFundWorker: Processing data took ${prettyMs(progress.elapsed)} at ${progress.speed.toFixed(2)}r/s and found ${((progress.found * 100) / progress.total).toFixed(2)}%`;
};

class ModalMaisFundWorker extends Worker {
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
                    const ui = new UI();

                    await mainClient.query('BEGIN TRANSACTION');

                    ui.start('ModalMaisFundWorkerData', 'ModalMaisFundWorker: Getting data from Modal Mais', null, progress => `ModalMaisFundWorker: Getting data from Modal Mais took ${prettyMs(progress.elapsed)}`, true);
                    const startData = process.hrtime();

                    const { funds, btgFunds: modalMaisFunds } = await getFundsData(mainClient);

                    ui.update('ModalMaisFundWorkerData', { elapsed: convertHrtime(process.hrtime(startData)).milliseconds });
                    ui.stop('ModalMaisFundWorkerData');

                    ui.start('ModalMaisFundWorkerDataProcessing', 'ModalMaisFundWorker: Processing data', createProcessingProgressInfo(), createProcessingFinishInfo());

                    const rowsToUpsert = discoverFunds(funds, modalMaisFunds, (progress) => ui.update('ModalMaisFundWorkerDataProcessing', progress));

                    ui.stop('ModalMaisFundWorkerDataProcessing');

                    ui.start('ModalMaisFundWorkerUpdate', 'ModalMaisFundWorker: Updating database', null, progress => `ModalMaisFundWorker: Updating database took ${prettyMs(progress.elapsed)}`, true);
                    const startUpdate = process.hrtime();

                    let newQuery = db.createUpsertQuery({
                        table: 'modalmais_funds',
                        primaryKey: 'mf_id',
                        values: rowsToUpsert
                    });

                    await mainClient.query({
                        text: newQuery,
                        rowMode: 'array'
                    });

                    ui.update('ModalMaisFundWorkerUpdate', { elapsed: convertHrtime(process.hrtime(startUpdate)).milliseconds });
                    ui.stop('ModalMaisFundWorkerUpdate');

                    ui.close();

                    await mainClient.query('COMMIT');
                } catch (ex) {
                    await mainClient.query('ROLLBACK');
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

const getFundsData = async (pool) => {
    return allKeys({
        funds: pool.query('SELECT f_cnpj, f_short_name FROM funds'),
        btgFunds: got.get('https://www.modalmais.com.br/wp-content/themes/Avada/js/modalmais/listaFundos.json?v=1&data').then(result => JSON.parse(result.body))
    });
};

const discoverFunds = (funds, modalMaisFunds, progressCallback) => {
    const progressState = {
        total: modalMaisFunds.length,
        start: process.hrtime(),
        found: 0,
        elapsed: 0,
        finished: 0,
        percentage: 0,
        eta: 0,
        speed: 0
    };

    const reportProgress = () => {
        progressState.elapsed = convertHrtime(process.hrtime(progressState.start)).milliseconds;
        progressState.speed = progressState.finished / (progressState.elapsed / 100);
        progressState.eta = ((progressState.elapsed * progressState.total) / progressState.finished) - progressState.elapsed;
        progressState.percentage = (progressState.finished * 100) / progressState.total;
        progressCallback(progressState);
    };

    reportProgress();

    const normalize = (name) => {
        return name.toLowerCase()
            .replace(/[àáâãäå]/gi, 'a')
            .replace(/æ/gi, 'ae')
            .replace(/ç/gi, 'c')
            .replace(/[èéêë]/gi, 'e')
            .replace(/[ìíîï]/gi, 'i')
            .replace(/ñ/gi, 'n')
            .replace(/[òóôõö]/gi, 'o')
            .replace(/œ/gi, 'oe')
            .replace(/[ùúûü]/gi, 'u')
            .replace(/[ýÿ]/gi, 'y')
            .replace(/(^| )(ficfim)( |$)/ig, '$1fic fim$3')
            .replace(/(^| )(ficfi)( |$)/ig, '$1fic fi$3')
            .replace(/(^| )(equity)( |$)/ig, '$1eq$3')
            .replace(/(^| )(equities)( |$)/ig, '$1eq$3')
            .replace(/(^| )(absoluto)( |$)/ig, '$1abs$3')
            .replace(/(^| )(fi cotas)( |$)/ig, '$1fic$3')
            .replace(/(^| )(fi acoes)( |$)/ig, '$1fia$3')
            .replace(/(^| )(cred priv)( |$)/ig, '$1cp$3')
            .replace(/(^| )(credito privado)( |$)/ig, '$1cp$3')
            .replace(/(^| )(cred corp)( |$)/ig, '$1cp$3')
            .replace(/(^| )(cred pri)( |$)/ig, '$1cp$3')
            .replace(/(^| )(deb in)( |$)/ig, '$1debenture incentivadas$3')
            .replace(/(^| )(deb inc)( |$)/ig, '$1debenture incentivadas$3')
            .replace(/(^| )(deb incent)( |$)/ig, '$1debenture incentivadas$3')
            .replace(/(^| )(deb incentivadas)( |$)/ig, '$1debenture incentivadas$3')
            .replace(/(^| )(infra incentivado)( |$)/ig, '$1debenture incentivadas$3')
            .replace(/(^| )(mult)( |$)/ig, '$1multistrategy$3')
            .replace(/(^| )(cap)( |$)/ig, '$1capital$3')
            .replace(/(^| )(small)( |$)/ig, '$1s$3')
            .replace(/(^| )(glob)( |$)/ig, '$1global$3')
            .replace(/(^| )(g)( |$)/ig, '$1global$3')
            .replace(/(^| )(de)( |$)/ig, ' ')
            .replace(/(^| )(acs)( |$)/ig, '$1access$3')
            .replace(/(^| )(cr)( |$)/ig, '$1credit$3')
            .replace(/(^| )(ref)( |$)/ig, '$1referenciado$3')
            .replace(/(^| )(fiq)( |$)/ig, '$1fic$3')
            .replace(/(^| )(fi multimercado)( |$)/ig, '$1fim$3')
            .replace(/(^| )(fi multimercad)( |$)/ig, '$1fim$3')
            .replace(/(^| )(fi multistrategy)( |$)/ig, '$1fim$3')
            .replace(/(^| )(lb)( |$)/ig, '$1long biased$3')
            .replace(/(^| )(ls)( |$)/ig, '$1long short$3')
            .replace(/(^| )(dl)( |$)/ig, '$1direct lending$3')
            .replace(/(^| )(fundo (?:de )?investimento)( |$)/ig, '$1fi$3')
            .replace(/(^| )(multimercado)( |$)/ig, '$1fim$3')
            .replace(/(^| )(acoes)( |$)/ig, '$1fia$3')
            .replace(/(^| )(renda fixa)( |$)/ig, '$1firf$3')
            .replace(/(^| )(investimento no exterior)( |$)/ig, '$1ie$3')
            .replace(/(^| )(fundo rf)( |$)/ig, '$1firf$3');
    };

    const avaliableFundsName = [];
    const avaliableFundsNameIndex = [];

    funds.rows.map((row, index) => {
        const normalizedName = normalize(row.f_short_name);
        avaliableFundsName.push(normalizedName);
        avaliableFundsNameIndex[normalizedName] = index;
    });

    let rowsToUpsert = [];

    modalMaisFunds.forEach(item => {
        const row = {
            mf_id: formatters.parseInt(item.InvestirLink),
            mf_cnpj: null,
            mf_date: (new Date()).toISOString(),
            mf_name: item.nome.replace(/'/g, ''),
            mf_risk_name: item.risco,
            mf_risk_level: formatters.parseInt(item.nivelRisco),
            mf_minimum_initial_investment: formatters.cleanBRMoney(item.aplicacaoMinima) / 100,
            mf_administration_fee: formatters.cleanBRMoney(item.taxaAdm) / 100,
            mf_start_date: item.startDate === '' ? null : moment.utc(item.dataInicio, 'DD/MM/YYYY').toISOString(),
            mf_target_audience: item.publicoAlvo,
            mf_profile: item.perfil,
            mf_net_equity: formatters.cleanBRMoney(item.PLmes) / 100,
            mf_net_equity_1y: formatters.cleanBRMoney(item.PL12meses) / 100,
            mf_benchmark: item.indexadorFundo,
            mf_rescue_quota: formatters.removeRelativeBRDate(item.CotaResgate),
            mf_rescue_financial_settlement: formatters.removeRelativeBRDate(item.PagamentoResgate),
            mf_minimum_moviment: formatters.cleanBRMoney(item.MovimentacaoMinima) / 100,
            mf_investment_quota: formatters.removeRelativeBRDate(item.CotacaoAplicacao),
            mf_minimal_amount_to_stay: formatters.cleanBRMoney(item.SaldoMinimo) / 100,
            mf_max_administration_fee: formatters.cleanBRMoney(item.TaxaMaxima) / 100,
            mf_performance_fee: formatters.cleanBRMoney(item.TaxaPerform) / 100,
            mf_tax_text: item.ImpostoRenda,
            mf_description: item.DescricaoFundo,
            mf_detail_link: item.linkDetalhe,
            mf_active: item.ativo == "1" ? true : false
        };

        const normalizedProduct = normalize(row.mf_name);
        const bestMatch = stringSimilarity.findBestMatch(normalizedProduct, avaliableFundsName).bestMatch;
        if (bestMatch.rating >= 0.80) {
            progressState.found++;
            row.mf_cnpj = funds.rows[avaliableFundsNameIndex[bestMatch.target]].f_cnpj;
        } else {
            console.log(`Not found: (${bestMatch.rating.toFixed(2)}): ${normalizedProduct} = ${bestMatch.target}\n`);
        }

        if (row.mf_id != null) rowsToUpsert.push(row);
        else console.log(`Fund '${normalizedProduct}' id is null, ignoring...`);

        progressState.finished++;
        reportProgress();
    });
    return rowsToUpsert;
};

module.exports = ModalMaisFundWorker;
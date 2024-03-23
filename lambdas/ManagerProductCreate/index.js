/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
const BUCKET = 'productimage-ogs-' + process.env.ENV
const tmpDir = 'tmp/';
const lambda = new AWS.Lambda();
const cloudwatchevents = new AWS.CloudWatchEvents();
const { v4: uuidv4 } = require('uuid');

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerAppRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'PS_' + process.env.ENV,
            WithDecryption: true
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
        process.env.ENVID = dbinfo.ENVID;
    }

    const ENVID = process.env.ENVID;

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    let {
        gachaDirectionId,
        gachaViewFlag,
        gachaSoldOutFlag,
        gachaCategoryId,
        gachaGenreId,
        gachaPostStartDate,
        gachaStartDate,
        gachaEndDate,
        gachaRemainingDisplayFlag,
        gachaCarouselFlag = 0,
        gachaMemo,
        gachaLimitResetPrize = [],
        gachaBonusExcludePrize = [],
        gachaTranslates = [],
        gachaPrizes = [],
        gachaId = null,
        createdBy = null,
    } = JSON.parse(event.body);

    let mysql_con;
    let response;
    console.log(JSON.parse(event.body));
    //getFileKeyFromSrc
    const getFileKeyFromSrc = async (imageSrc) => {
        // return imageSrc ? imageSrc.split("/").pop() : '';
        const tempDte = Math.floor(new Date().getTime() / 1000);
        if (imageSrc) {
            let imgInfo = imageSrc.split("/");
            console.log('imgInfo', imgInfo);
            let oldFileName = imgInfo[imgInfo.length - 1];
            let dirName = imgInfo[imgInfo.length - 2];
            let fileExt = oldFileName.split(".");
            let orgFName = fileExt[0];
            if (orgFName.includes("-")) {
                orgFName = orgFName.split("-")[0];
            }
            let newFileName = `${orgFName}-${tempDte}.${fileExt[1]}`;

            return {
                oldFileName: oldFileName,
                newFileName: newFileName,
                dirName: dirName,
            }
        }
        return false;
    }
    //moveObject
    const moveObejectFile = async (sourceKey, destinationKey, dir = 'tmp') => {
        let destLocationUrl = '';
        const params = {
            Bucket: BUCKET,
            CopySource: `${BUCKET}/${sourceKey}`,
            Key: destinationKey,
        };
        const params2 = {
            Bucket: BUCKET,
            Key: sourceKey,
        };

        let copyRes = await s3.copyObject(params).promise();
        if (dir == 'tmp') {
            await s3.deleteObject(params2).promise();
        }

        console.log('copyRes', copyRes);
        return copyRes;
    }

    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        await mysql_con.beginTransaction();

        let gacha_query = `
            INSERT INTO Gacha (
                gachaUUID,
                gachaOrder,
                gachaDirectionId,
                gachaViewFlag,
                gachaSoldOutFlag,
                gachaCategoryId,
                gachaGenreId,
                gachaPostStartDate,
                gachaStartDate,
                gachaEndDate,
                gachaRemainingDisplayFlag,
                gachaCarouselFlag,
                gachaMemo,
                gachaCreatedAt,
                gachaUpdatedAt,
                gachaCreatedBy,
                gachaUpdatedBy
            ) VALUES (UUID_TO_BIN(UUID()), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        gachaPostStartDate = Math.floor(gachaPostStartDate / 1000);
        gachaStartDate = Math.floor(gachaStartDate / 1000);
        gachaEndDate = Math.floor(gachaEndDate / 1000);
        const createdAt = Math.floor(new Date().getTime() / 1000);

        const sql_param = [
            1,
            gachaDirectionId,
            gachaViewFlag,
            gachaSoldOutFlag,
            gachaCategoryId,
            gachaGenreId,
            gachaPostStartDate,
            gachaStartDate,
            gachaEndDate,
            gachaRemainingDisplayFlag,
            gachaCarouselFlag,
            gachaMemo,
            createdAt,
            createdAt,
            createdBy,
            createdBy,
        ];

        const [query_result] = await mysql_con.execute(gacha_query, sql_param);

        console.log("sql_param", sql_param);

        let lastInsertedGachaId = query_result.insertId;

        //Insert GachaTranslate
        if (gachaTranslates.length > 0) {
            const gacha_translate_query = 'INSERT INTO GachaTranslate (gachaTranslateGachaId, gachaTranslateTranslateId, gachaTranslateName, gachaTranslateDescription, gachaTranslateImageMain, gachaTranslateImageDetail, gachaTranslateJpFlag) VALUES ?';

            let gacha_translate_sql_param = [];
            for (let j = 0; j < gachaTranslates.length; j++) {
                const { gachaTranslateTranslateId, gachaTranslateName, gachaTranslateDescription, gachaTranslateImageMain, gachaTranslateImageDetail, gachaTranslateJpFlag = 0 } = gachaTranslates[j] || {};

                let imagePathMain = '';
                let imagePathDetail = '';
                if (gachaTranslateImageMain) {
                    let fileInfoMain = await getFileKeyFromSrc(gachaTranslateImageMain);
                    if (fileInfoMain) {
                        let sourceKey = `${fileInfoMain?.dirName}/${fileInfoMain?.oldFileName}`;
                        let destinationKey = `${gachaCategoryId}/${fileInfoMain?.newFileName}`;
                        await moveObejectFile(sourceKey, destinationKey, fileInfoMain?.dirName);
                        let imageUrl1 = gachaTranslateImageMain.split(`/${fileInfoMain?.dirName}/`)[0];
                        imagePathMain = `${imageUrl1}/${destinationKey}`;
                    }
                }
                if (gachaTranslateImageDetail) {
                    let fileInfoDetail = await getFileKeyFromSrc(gachaTranslateImageDetail);
                    if (fileInfoDetail) {
                        let sourceKey = `${fileInfoDetail?.dirName}/${fileInfoDetail?.oldFileName}`;
                        let destinationKey = `${gachaCategoryId}/${fileInfoDetail?.newFileName}`;
                        await moveObejectFile(sourceKey, destinationKey, fileInfoDetail?.dirName);
                        let imageUrl = gachaTranslateImageDetail.split(`/${fileInfoDetail?.dirName}/`)[0];
                        imagePathDetail = `${imageUrl}/${destinationKey}`;
                    }
                }

                gacha_translate_sql_param.push([
                    lastInsertedGachaId,
                    gachaTranslateTranslateId,
                    gachaTranslateName,
                    gachaTranslateDescription,
                    imagePathMain,
                    imagePathDetail,
                    gachaTranslateJpFlag
                ]);
            }

            await mysql_con.query(gacha_translate_query, [gacha_translate_sql_param]);
        }

        //Insert GachaPrize
        if (gachaPrizes.length > 0) {
            const gacha_prize_query = 'INSERT INTO GachaPrize (gachaPrizeGachaId, gachaPrizeName, gachaPrizeType, gachaPrizeOrder, gachaPrizePoint, gachaPrizeEmissionsCount, gachaPrizeSetItem, gachaPrizeSetVideo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            let gachaPrizeIdList = [];
            let gachaBonusExcludePrizeIds = [];
            for (let i = 0; i < gachaPrizes.length; i++) {
                let gachaPrizeEmissionsCount = 0, gachaPrizePoint = 0, gachaPrizeSetItem = null, gachaPrizeSetVideo = null;
                if (gachaId) {
                    const remove_gacha_prize_query = `SELECT * FROM GachaPrize WHERE gachaPrizeGachaId = ? and gachaPrizeId = ?`;
                    const [gacha_prize_resultss] = await mysql_con.query(remove_gacha_prize_query, [gachaId, gachaPrizes[i].gachaPrizeId]);
                    if (gacha_prize_resultss && gacha_prize_resultss[0]) {
                        gachaPrizeEmissionsCount = gacha_prize_resultss[0].gachaPrizeEmissionsCount;
                        gachaPrizeSetItem = gacha_prize_resultss[0].gachaPrizeSetItem;
                        gachaPrizeSetVideo = gacha_prize_resultss[0].gachaPrizeSetVideo;
                        gachaPrizePoint = gacha_prize_resultss[0].gachaPrizePoint;
                    }
                }
                const { gachaPrizeName, gachaPrizeType = 0 } = gachaPrizes[i] || {};

                let prizeParam = [
                    lastInsertedGachaId,
                    gachaPrizeName,
                    gachaPrizeType,
                    i + 1,
                    gachaPrizePoint,
                    gachaPrizeEmissionsCount,
                    gachaPrizeSetItem,
                    gachaPrizeSetVideo,
                ];
                const [query_result_prizw] = await mysql_con.query(gacha_prize_query, prizeParam);
                console.log('query_result_prizw.insertId', query_result_prizw.insertId);
                if (gachaLimitResetPrize && gachaLimitResetPrize.length > 0 && gachaLimitResetPrize.includes(gachaPrizes[i].gachaPrizeId)) {
                    gachaPrizeIdList.push(query_result_prizw.insertId);
                }

                if (gachaBonusExcludePrize && gachaBonusExcludePrize.length > 0 && gachaBonusExcludePrize.includes(gachaPrizes[i].gachaPrizeId)) {
                    gachaBonusExcludePrizeIds.push(query_result_prizw.insertId);
                }
            }
            console.log('gachaPrizeIdList', gachaPrizeIdList);
            if (gachaPrizeIdList) {
                gachaLimitResetPrize = gachaPrizeIdList.length > 0 ? JSON.stringify(gachaPrizeIdList) : null;
                let updateGacha = `UPDATE Gacha SET gachaLimitResetPrize = ? where gachaId = ?`;
                await mysql_con.query(updateGacha, [gachaLimitResetPrize, lastInsertedGachaId]);
            }

            console.log('gachaBonusExcludePrizeIds', gachaBonusExcludePrizeIds);
            if (gachaBonusExcludePrizeIds) {
                gachaBonusExcludePrize = gachaBonusExcludePrizeIds.length > 0 ? JSON.stringify(gachaBonusExcludePrizeIds) : null;
                let updateGacha = `UPDATE Gacha SET gachaBonusExcludePrize = ? where gachaId = ?`;
                await mysql_con.query(updateGacha, [gachaBonusExcludePrize, lastInsertedGachaId]);
            }

            //get prevGacha data
            if (gachaId) {
                let gacha_prev_sql = `select * from Gacha where gachaId = ?`;
                const [query_result_gacha] = await mysql_con.query(gacha_prev_sql, [gachaId]);
                if (query_result_gacha && query_result_gacha[0]) {
                    let {
                        gachaTotalCount = 1,
                        gachaSinglePoint = 1,
                        gachaLoopFlag = 0,
                        gachaConosecutiveCount = 10,
                        gachaConosecutivePoint = 0,
                        gachaLimitOncePerDay = 0,
                        gachaLimitEveryonePerDay = 0,
                        gachaLimitOnce = 0,
                        gachaAllRestCount = 0,
                        gachaLimitCount = 0,
                        gachaLastOneFlag = 0,
                        gachaLuckyNumber1 = null,
                        gachaLuckyNumber1MatchFlag = 0,
                        gachaLuckyNumber2 = null,
                        gachaLuckyNumber2MatchFlag = 0,
                        gachaLuckyNumber3 = null,
                        gachaLuckyNumber3MatchFlag = 0,
                        gachaLuckyNumber4 = null,
                        gachaLuckyNumber4MatchFlag = 0,
                        gachaLuckyNumber5 = null,
                        gachaLuckyNumber5MatchFlag = 0,
                        gachaLuckyNumber6 = null,
                        gachaLuckyNumber6MatchFlag = 0,
                        gachaLuckyNumber7 = null,
                        gachaLuckyNumber7MatchFlag = 0
                    } = query_result_gacha[0] || '';

                    let updateGacha1 = `UPDATE Gacha SET 
                        gachaTotalCount = ?,
                        gachaSinglePoint = ?,
                        gachaLoopFlag = ?,
                        gachaConosecutiveCount = ?,
                        gachaConosecutivePoint = ?,
                        gachaLimitOncePerDay = ?,
                        gachaLimitEveryonePerDay = ?,
                        gachaLimitOnce = ?,
                        gachaAllRestCount = ?,
                        gachaLimitCount = ?,
                        gachaLastOneFlag = ?,
                        gachaLuckyNumber1 = ?,
                        gachaLuckyNumber1MatchFlag = ?,
                        gachaLuckyNumber2 = ?,
                        gachaLuckyNumber2MatchFlag = ?,
                        gachaLuckyNumber3 = ?,
                        gachaLuckyNumber3MatchFlag = ?,
                        gachaLuckyNumber4 = ?,
                        gachaLuckyNumber4MatchFlag = ?,
                        gachaLuckyNumber5 = ?,
                        gachaLuckyNumber5MatchFlag = ?,
                        gachaLuckyNumber6 = ?,
                        gachaLuckyNumber6MatchFlag = ?,
                        gachaLuckyNumber7 = ?,
                        gachaLuckyNumber7MatchFlag = ?
                    where gachaId = ?`;

                    let updatedParam = [
                        gachaTotalCount,
                        gachaSinglePoint,
                        gachaLoopFlag,
                        gachaConosecutiveCount,
                        gachaConosecutivePoint,
                        gachaLimitOncePerDay,
                        gachaLimitEveryonePerDay,
                        gachaLimitOnce,
                        gachaAllRestCount,
                        gachaLimitCount,
                        gachaLastOneFlag,
                        gachaLuckyNumber1,
                        gachaLuckyNumber1MatchFlag,
                        gachaLuckyNumber2,
                        gachaLuckyNumber2MatchFlag,
                        gachaLuckyNumber3,
                        gachaLuckyNumber3MatchFlag,
                        gachaLuckyNumber4,
                        gachaLuckyNumber4MatchFlag,
                        gachaLuckyNumber5,
                        gachaLuckyNumber5MatchFlag,
                        gachaLuckyNumber6,
                        gachaLuckyNumber6MatchFlag,
                        gachaLuckyNumber7,
                        gachaLuckyNumber7MatchFlag,
                        lastInsertedGachaId
                    ];
                    await mysql_con.query(updateGacha1, updatedParam);

                }
            }
            //get prevGacha data
        }

        //Shift gachaOrder
        await gachaOrderShiftingProcess(lastInsertedGachaId);

        await mysql_con.commit();

        // lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
        let invokeParams = {
            FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
            InvocationType: "RequestResponse"
        };
        // invoke lambda
        let result = await lambda.invoke(invokeParams).promise();
        if (result.$response.error) throw (500, result.$response.error.message);

        await generateSchedule(gachaEndDate, lastInsertedGachaId);

        response = {
            records: query_result[0]
        };

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        if (mysql_con) await mysql_con.rollback();
        console.error("error:", error)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }

    async function gachaOrderShiftingProcess(ignoreGachaId) {
        const count = `SELECT COUNT(*) AS cnt FROM Gacha WHERE gachaId != ?`;
        let [gachaCount] = await mysql_con.query(count, [ignoreGachaId]);
        console.log("gacha count = ", gachaCount[0].cnt);

        let k = 0;
        let l = 2000;
        let updateOrder = 2;

        for (let i = 0; i < Math.ceil(gachaCount[0].cnt / l); i++) {
            const gacha_data_sql = `SELECT gachaId FROM Gacha WHERE gachaId != ? ORDER by gachaOrder ASC LIMIT ?, ?`;
            let [gachaResult] = await mysql_con.query(gacha_data_sql, [ignoreGachaId, k, l]);

            const gachaIds = [];
            const newOrderValues = [];
            for (const row of gachaResult) {
                const { gachaId } = row || {};

                gachaIds.push(gachaId);
                newOrderValues.push(updateOrder);

                updateOrder += 1;
            }

            const order_update_sql = `UPDATE Gacha SET gachaOrder = ELT(FIELD(gachaId, ${gachaIds}), ${newOrderValues}) WHERE gachaId IN (${gachaIds})`;
            await mysql_con.execute(order_update_sql, []);

            k += l;
        }
    };

    async function generateSchedule(gachaEndDate, gachaId) {
        const date = new Date(gachaEndDate * 1000);
        const options = {
            timeZone: 'Asia/Tokyo',
            hour12: false, // Use 24-hour format
        };
        const japanTimeStr = date.toLocaleString('en-US', options);

        console.log('japan datetime -> raw', gachaEndDate)
        console.log('japan japanTimeStr', japanTimeStr)

        const japanTime = new Date(japanTimeStr);
        const utcTime = new Date(japanTime.getTime());

        const hour = utcTime.getUTCHours();
        const minute = utcTime.getUTCMinutes();
        const dayOfMonth = utcTime.getUTCDate();
        const dayOfWeek = utcTime.getUTCDay();
        const month = utcTime.getUTCMonth() + 1;
        const year = utcTime.getUTCFullYear();

        console.log('raq date', utcTime)
        console.log('hour', hour)
        console.log('minute', minute)
        console.log('dayOfMonth', dayOfMonth)
        console.log('month', month)

        const scheduleExpression = `cron(${minute} ${hour} ${dayOfMonth} ${month} ? ${year})`;
        const ruleName = `GachaEndScheduleRule-${ENVID}-${gachaId}`;
        const targetArn = 'arn:aws:lambda:ap-northeast-1:225702177590:function:SystemRedisGachaExport-' + process.env.ENV;
        console.log('scheduleExpression >>>>', scheduleExpression)

        //Create / Update Rule
        const ruleParams = {
            Name: ruleName,
            ScheduleExpression: scheduleExpression,
            State: 'ENABLED',
            Description: 'Alarm triggering Lambda at' + japanTime,
        };

        const ruleResponse = await cloudwatchevents.putRule(ruleParams).promise();
        console.log('Rule created', ruleResponse);

        //Check same target already assign or not 
        const targetResults = await cloudwatchevents.listTargetsByRule({ Rule: ruleName }).promise();

        console.log('my asiign targets >>>', targetResults)

        const targetExists = targetResults.Targets.some(x => x.Arn == targetArn);

        if (!targetExists) {
            const targetParams = {
                Rule: ruleName,
                Targets: [
                    {
                        Arn: targetArn,
                        Id: uuidv4()
                    },
                ],
            };

            const targetResponse = await cloudwatchevents.putTargets(targetParams).promise();
            console.log('Target added to rule', targetResponse);
        }
    }

}
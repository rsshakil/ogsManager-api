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
        gachaLimitResetPrize = [],
        gachaBonusExcludePrize = [],
        gachaTranslates = [],
        gachaPrizes = [],
        updatedBy = null,
    } = JSON.parse(event.body);

    let mysql_con;
    let response;
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

        const { pathParameters: { gachaId = 0 } } = event || {};

        if (gachaId) {
            await mysql_con.beginTransaction();

            gachaPostStartDate = Math.floor(gachaPostStartDate / 1000);
            gachaStartDate = Math.floor(gachaStartDate / 1000);
            gachaEndDate = Math.floor(gachaEndDate / 1000);
            const updatedAt = Math.floor(new Date().getTime() / 1000);

            //Update Gacha
            let gacha_update_query = `UPDATE Gacha SET 
                gachaViewFlag = ?,
                gachaSoldOutFlag = ?,
                gachaCategoryId = ?,
                gachaGenreId = ?,
                gachaPostStartDate = ?,
                gachaStartDate = ?,
                gachaEndDate = ?,
                gachaRemainingDisplayFlag = ?,
                gachaCarouselFlag = ?,
                gachaMemo = ?,
                gachaUpdatedAt = ?,
                gachaUpdatedBy = ?
                WHERE gachaId = ?
            `;

            const sql_param = [
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
                updatedAt,
                updatedBy,
                gachaId,
            ];
            const [query_result] = await mysql_con.execute(gacha_update_query, sql_param);

            //Update GachaTranslate
            const remove_gacha_translate_query = `DELETE FROM GachaTranslate WHERE gachaTranslateGachaId = ?`;
            await mysql_con.query(remove_gacha_translate_query, [gachaId]);

            if (gachaTranslates.length > 0) {
                const gacha_translate_query = 'INSERT INTO GachaTranslate (gachaTranslateGachaId, gachaTranslateTranslateId, gachaTranslateName, gachaTranslateDescription, gachaTranslateImageMain, gachaTranslateImageDetail, gachaTranslateJpFlag) VALUES ?';

                let gacha_translate_sql_param = [];
                for (let j = 0; j < gachaTranslates.length; j++) {
                    const { gachaTranslateTranslateId, gachaTranslateName, gachaTranslateDescription, gachaTranslateImageMain, gachaTranslateImageDetail, gachaTranslateJpFlag = 0 } = gachaTranslates[j] || {};

                    console.log("gachaTranslates[j]", gachaTranslates[j]);
                    console.log("gachaTranslateJpFlag", gachaTranslateJpFlag);

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
                        gachaId,
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

            const read_gacha_prize_query = `SELECT * FROM GachaPrize WHERE gachaPrizeGachaId = ? AND gachaPrizeStatus = ?`;
            const [gacha_prize_results] = await mysql_con.query(read_gacha_prize_query, [gachaId, 1]);

            // Extract gachaPrizeIds from each array
            const gachaPrizeIdsFromResults = gacha_prize_results.map((prize) => prize.gachaPrizeId);
            const gachaPrizeIds = gachaPrizes.map((prize) => prize.gachaPrizeId);

            // Find the IDs that exist in gacha_prize_results but not in gachaPrizes
            const missingGachaPrizeIds = gachaPrizeIdsFromResults.filter((id) => !gachaPrizeIds.includes(id));

            console.log('missingGachaPrizeIds', missingGachaPrizeIds);
            if (missingGachaPrizeIds.length > 0) {
                // Delete missing gacha prize
                const gacha_prize_delete = `UPDATE GachaPrize SET gachaPrizeStatus = ? WHERE gachaPrizeId IN (?)`;
                await mysql_con.query(gacha_prize_delete, [2, missingGachaPrizeIds]);
            }

            if (gachaPrizes.length > 0) {
                const gacha_prize_query = 'INSERT INTO GachaPrize (gachaPrizeGachaId, gachaPrizeName, gachaPrizeType, gachaPrizeOrder, gachaPrizeEmissionsCount, gachaPrizeSetItem, gachaPrizeSetVideo) VALUES (?, ?, ?, ?, ?, ?, ?)';
                let gachaPrizeIdList = [];
                let gachaBonusExcludePrizeIds = [];
                for (let i = 0; i < gachaPrizes.length; i++) {
                    const { gachaPrizeName, gachaPrizeType = 0, gachaPrizeEmissionsCount = 0, gachaPrizeSetItem = null, gachaPrizeSetVideo = null } = gachaPrizes[i] || {};
                    let gPrizeId = 0;

                    // const read_gacha_prize_query = `SELECT * FROM GachaPrize WHERE gachaPrizeGachaId = ? and gachaPrizeId = ?`;
                    // const [gacha_prize_resultss] = await mysql_con.query(read_gacha_prize_query, [gachaId, gachaPrizes[i].gachaPrizeId]);
                    //if (gacha_prize_resultss && gacha_prize_resultss[0]) {

                    const targetGachaPrize = gacha_prize_results.find(item => item.gachaPrizeId == gachaPrizes[i].gachaPrizeId);

                    if (targetGachaPrize) {
                        let updateSql = `UPDATE GachaPrize set gachaPrizeName = ?, gachaPrizeOrder = ? where gachaPrizeGachaId = ? and gachaPrizeId = ?`;
                        await mysql_con.query(updateSql, [gachaPrizeName, i + 1, gachaId, gachaPrizes[i].gachaPrizeId]);
                        gPrizeId = gachaPrizes[i].gachaPrizeId;
                    } else {
                        let prizeParam = [
                            gachaId,
                            gachaPrizeName,
                            gachaPrizeType,
                            i + 1,
                            gachaPrizeEmissionsCount,
                            gachaPrizeSetItem,
                            gachaPrizeSetVideo,
                        ];
                        const [query_result_prizw] = await mysql_con.query(gacha_prize_query, prizeParam);
                        console.log('query_result_prizw.insertId', query_result_prizw.insertId);
                        gPrizeId = query_result_prizw.insertId;
                    }

                    if (gachaLimitResetPrize && gachaLimitResetPrize.length > 0 && gachaLimitResetPrize.includes(gPrizeId)) {
                        gachaPrizeIdList.push(gPrizeId);
                    }

                    if (gachaBonusExcludePrize && gachaBonusExcludePrize.length > 0 && gachaBonusExcludePrize.includes(gPrizeId)) {
                        gachaBonusExcludePrizeIds.push(gPrizeId);
                    }
                }
                console.log('gachaPrizeIdList', gachaPrizeIdList);
                if (gachaPrizeIdList) {
                    gachaLimitResetPrize = gachaPrizeIdList.length > 0 ? JSON.stringify(gachaPrizeIdList) : null;
                    let updateGacha = `UPDATE Gacha SET gachaLimitResetPrize = ? where gachaId = ?`;
                    await mysql_con.query(updateGacha, [gachaLimitResetPrize, gachaId]);
                }

                console.log('gachaBonusExcludePrizeIds', gachaBonusExcludePrizeIds);
                if (gachaBonusExcludePrizeIds) {
                    gachaBonusExcludePrize = gachaBonusExcludePrizeIds.length > 0 ? JSON.stringify(gachaBonusExcludePrizeIds) : null;
                    let updateGacha = `UPDATE Gacha SET gachaBonusExcludePrize = ? where gachaId = ?`;
                    await mysql_con.query(updateGacha, [gachaBonusExcludePrize, gachaId]);
                }
            }
            await mysql_con.commit();

            //lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
            let invokeParams = {
                FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
                InvocationType: "RequestResponse"
            };
            // invoke lambda
            let result = await lambda.invoke(invokeParams).promise();
            if (result.$response.error) throw (500, result.$response.error.message);

            await generateSchedule(gachaEndDate, gachaId);

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
        }
        else {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify('gachaId is missing in pathParameters.'),
            }
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
};
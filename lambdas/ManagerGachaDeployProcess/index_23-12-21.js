/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const redis = require("ioredis");
const _ = require("lodash");

const ITEMS_PER_PAGE = 1000;

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
			Name: "PS_" + process.env.ENV,
			WithDecryption: true,
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
		process.env.REDISPOINT1 = dbinfo.REDISPOINT1;
		process.env.REDISPOINT2 = dbinfo.REDISPOINT2;
		process.env.ENVID = dbinfo.ENVID;
	}
	const ENVID = process.env.ENVID;
	// Database info
	const writeDbConfig = {
		host: process.env.DBWRITEENDPOINT,
		user: process.env.DBUSER,
		password: process.env.DBPASSWORD,
		database: process.env.DBDATABSE,
		charset: process.env.DBCHARSET,
	};
	let mysql_con;
	const redisConfig = [
		{ host: process.env.REDISPOINT1, port: 6379 },
		{ host: process.env.REDISPOINT2, port: 6379 },
	];
	const cluster = new redis.Cluster(redisConfig, {
		dnsLookup: (address, callback) => callback(null, address),
		redisOptions: { tls: true },
	});

	const {
		pathParameters: { gachaId = 0 },
	} = event || {};

	try {
		// mysql connect
		mysql_con = await mysql.createConnection(writeDbConfig);
		await mysql_con.beginTransaction();
		// ステータスが5の場合、1に変更する
		let statusSQL = `SELECT * FROM Gacha WHERE gachaId = ?`;
		const [gachaStatusResult] = await mysql_con.execute(statusSQL, [gachaId]);
		// ステータスが5以外の場合この先に進めない
		if (
			!(
				gachaStatusResult &&
				gachaStatusResult[0] &&
				gachaStatusResult[0].gachaStatus &&
				gachaStatusResult[0].gachaStatus == 5
			)
		) {
			console.log("status failure!", gachaStatusResult[0].gachaStatus);
			throw new Error(507);
		}
		// 念の為Redisから削除する
		await cluster.del("gacha:" + ENVID + ":" + gachaId + ":list");
		await cluster.del("gacha:" + ENVID + ":" + gachaId + ":limit:list");
		// emissionをlistに書き出す
		const count = `SELECT COUNT(*) AS cnt FROM GachaEmission 
				WHERE gachaEmissionGachaId = ?`;
		let [gachaCount] = await mysql_con.query(count, [gachaId]);
		console.log("gacha count = ", gachaCount[0].cnt);
		// ループ
		let k = 0;
		let l = 30000;
		let gachaHistoryRecords = [];
		// 1000件ずつ格納
		for (let i = 0; i < Math.floor(gachaCount[0].cnt / l) + 1; i++) {
			const gachaData = `SELECT 
					gachaEmissionId,
                    gachaEmissionItemId,
                    gachaEmissionItemPoint,
                    gachaEmissionVideoId,
                    gachaEmissionBonusItemId,
                    gachaEmissionBonusItemPoint,
                    gachaEmissionBonusVideoId,
                    gachaEmissionVideoPriority,
                    GP1.gachaPrizeOrder AS order1,
                    GP2.gachaPrizeOrder AS order2,
                    BIN_TO_UUID(gachaEmissionUUID) AS gachaEmissionUUID,
					gachaEmissionPrizeId
                FROM GachaEmission
                LEFT OUTER JOIN GachaPrize AS GP1 ON gachaEmissionPrizeId = GP1.gachaPrizeId
                LEFT OUTER JOIN GachaPrize AS GP2 ON gachaEmissionBonusPrizeId = GP2.gachaPrizeId
                WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder >= 1
                ORDER BY gachaEmissionOrder LIMIT ?, ?`;
			// console.log("@@@@@ i = ", i);
			// console.log("@@@@ k = ", k);
			// console.log("@@@@ l = ", l);
			let [gachaResult] = await mysql_con.query(gachaData, [gachaId, k, l]);
			const pipeline = cluster.pipeline();
			// console.log("@@@@@ length = ", gachaResult.length);
			for (let j = 0; j < gachaResult.length; j++) {
				let videoId;
				if (
					gachaResult[j].order2 == null ||
					gachaResult[j].order1 < gachaResult[j].order2
				) {
					videoId = gachaResult[j].gachaEmissionVideoId;
				} else {
					videoId = gachaResult[j].gachaEmissionBonusVideoId;
				}
				// console.log("gachaResult[j].order1", gachaResult[j].order1);
				// console.log("gachaResult[j].order2", gachaResult[j].order2);
				// console.log("gachaResult[j].gachaEmissionVideoId", gachaResult[j].gachaEmissionVideoId);
				// console.log("gachaResult[j].gachaEmissionBonusVideoId", gachaResult[j].gachaEmissionBonusVideoId);
				// console.log("videoId", videoId);
				let itemData = {
					eid: gachaResult[j].gachaEmissionId,
					ii: gachaResult[j].gachaEmissionItemId, // itemId
					ip: gachaResult[j].gachaEmissionItemPoint, // itemPoint
					bi: gachaResult[j].gachaEmissionBonusItemId, // bonusItemId
					bp: gachaResult[j].gachaEmissionBonusItemPoint, // bonusPoint
					vi: videoId, // videoId
					vp: gachaResult[j].gachaEmissionVideoPriority, // bonusVideoId
					// uuid: gachaResult[j].gachaEmissionUUID, // uuid
					pi: gachaResult[j].gachaEmissionPrizeId
				};
				pipeline.rpush(
					"gacha:" + ENVID + ":" + gachaId + ":list",
					JSON.stringify(itemData)
				);
			}
			await pipeline.exec();
			k += l;
			console.log("xxx---2", k);

			//Store Gacha Product History

			//Delete old gacha product history records
			const gacha_history_delete = `DELETE FROM GachaHistory WHERE gachaHistoryGachaId = ?`;
			await mysql_con.query(gacha_history_delete, [gachaId]);

			if (gachaResult.length > 0) {
				const gachaEmissionItemIds = gachaResult.reduce((acc, item) => {
					const { gachaEmissionItemId, gachaEmissionBonusItemId } = item || {};

					if (gachaEmissionItemId) acc.push(gachaEmissionItemId);
					if (gachaEmissionBonusItemId) acc.push(gachaEmissionBonusItemId);

					return acc;
				}, []);
				// console.log("gachaEmissionItemIds >>>> ", gachaEmissionItemIds);
				const item_translate_sql = `
					SELECT 
						translateId,
						itemTranslateItemId,
						itemTranslateName, 
						translateLanguageId,
						languageCode,
						translateJpFlag
					FROM ItemTranslate 
					JOIN Translate ON itemTranslateTranslateId = translateId
					JOIN Language ON languageId = translateLanguageId
					WHERE itemTranslateItemId IN (?)`;
				const [item_translate_result_data] = await mysql_con.query(item_translate_sql, [gachaEmissionItemIds]);
				const groupedRecords = _.groupBy(item_translate_result_data, "translateId");

				let modifiedRecords = [];

				Object.keys(groupedRecords).forEach((key) => {
					const records = groupedRecords[key] || {};
					let itemTranslateNames = [];

					for (const itemId of gachaEmissionItemIds) {
						const result = records.find((x) => x.itemTranslateItemId == itemId);
						if (result) itemTranslateNames.push(result.itemTranslateName);
						else itemTranslateNames.push("");
					}

					if (records.length > 0) {
						modifiedRecords.push({
							translateId: key,
							translateLanguageId: records[0].translateLanguageId,
							languageCode: records[0].languageCode,
							translateJpFlag: records[0].translateJpFlag,
							itemTranslateNames: itemTranslateNames,
						});
					}
				});

				const pipelineDLang = cluster.pipeline();
				for (const item of modifiedRecords) {
					pipelineDLang.get(`language:${item.translateLanguageId}:default`);
				}
				const result = await pipelineDLang.exec();

				// console.log('REsults of default language value', result)
				// console.log("my modified records ", modifiedRecords);

				let gachaProductHistoryData = [];

				for (let j = 0; j < modifiedRecords.length; j++) {
					const row = modifiedRecords[j] || {};
					let { itemTranslateNames } = row;

					for (let i = 0; i < itemTranslateNames.length; i++) {
						let modifiedName = itemTranslateNames[i];

						//If empty then set default language name
						if (!modifiedName) {
							const defaultLanCode = result[j][1];
							if (defaultLanCode) {
								const defaultLanDetail = modifiedRecords.find((x) => x.languageCode == defaultLanCode);
								const defaultLanTranslateName = defaultLanDetail.itemTranslateNames[i];

								// console.log('default detail', defaultLanDetail)
								// console.log('default i', i)
								// console.log('default defaultLanTranslateName', defaultLanTranslateName)

								if (defaultLanTranslateName) {
									modifiedName = defaultLanTranslateName;
									itemTranslateNames[i] = modifiedName;
									continue;
								}
							}

							//If empty then set jp language
							const jpLanDetail = modifiedRecords.find((x) => x.languageCode == "ja");
							const jpLanTranslateName = jpLanDetail.itemTranslateNames[i];
							modifiedName = jpLanTranslateName;
						}
						itemTranslateNames[i] = modifiedName;
					}
					gachaProductHistoryData.push({
						...row,
						itemTranslateNames,
					});
				}

				if (gachaHistoryRecords.length == 0) {
					gachaHistoryRecords = gachaProductHistoryData;
				} else {
					gachaHistoryRecords = gachaHistoryRecords.map((x) => {
						const partResult = gachaProductHistoryData.find((item) => item.translateId == x.translateId);

						if (partResult) {
							return {
								...x,
								itemTranslateNames: [
									...x.itemTranslateNames,
									...partResult.itemTranslateNames,
								],
							};
						}
						return x;
					});
				}
			}
		}

		console.log("xxx---3");
		// 天井賞のRedis出力 TODO
		const gachaLimitData = `SELECT 
				gachaEmissionId,
                gachaEmissionBonusItemId,
                gachaEmissionBonusItemPoint,
                gachaEmissionBonusVideoId,
                gachaEmissionVideoPriority,
                BIN_TO_UUID(gachaEmissionUUID) AS gachaEmissionUUID
            FROM GachaEmission
            LEFT OUTER JOIN GachaPrize AS GP1 ON gachaEmissionPrizeId = GP1.gachaPrizeId
            LEFT OUTER JOIN GachaPrize AS GP2 ON gachaEmissionBonusPrizeId = GP2.gachaPrizeId
            WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder = 0`;
		let [gachaLimitResult] = await mysql_con.query(gachaLimitData, [gachaId]);

		const pipeline2 = cluster.pipeline();
		for (let i = 0; i < gachaLimitResult.length; i++) {
			let itemData = {
				eid: gachaLimitResult[i].gachaEmissionId,
				bi: gachaLimitResult[i].gachaEmissionBonusItemId, // bonusItemId
				bp: gachaLimitResult[i].gachaEmissionBonusItemPoint, // bonusPoint
				vi: gachaLimitResult[i].gachaEmissionBonusVideoId, // videoId
				vp: gachaLimitResult[i].gachaEmissionVideoPriority, // bonusVideoId
				// uuid: gachaLimitResult[i].gachaEmissionUUID, // uuid
			};
			pipeline2.rpush(
				"gacha:" + ENVID + ":" + gachaId + ":limit:list",
				JSON.stringify(itemData)
			);
		}
		await pipeline2.exec();

		// １に変更する
		let updateSQL = `UPDATE Gacha SET gachaStatus = 1, gachaRemainingCount = gachaTotalCount WHERE gachaId = ?`;
		const [updateGachaStatusResult] = await mysql_con.execute(updateSQL, [gachaId]);

		//Insert History data NB: This feature also present in other lambda function checkGachaDeploy
		if (gachaHistoryRecords.length > 0) {
			// console.log('lp', gachaHistoryRecords)
			const gacha_history_insert_query = `INSERT INTO GachaHistory (gachaHistoryGachaId, gachaHistoryPageNumber, gachaHistoryData, gachaHistoryTranslateId) VALUES ?`;

			let insertValues = [];
			for (const row of gachaHistoryRecords) {
				const { translateId, itemTranslateNames } = row || {};
				let j = 1;
				for (let i = 0; i < itemTranslateNames.length; i += ITEMS_PER_PAGE) {
					const pageNumber = Math.ceil(j / ITEMS_PER_PAGE);

					const itemTranslateNameChunk = itemTranslateNames
						.slice(i, i + ITEMS_PER_PAGE)
						.map((name, index) => ({ o: (j + index), i: name }));
					j += ITEMS_PER_PAGE;
					console.log("itemTranslateNameChunk", itemTranslateNameChunk);
					insertValues.push([
						gachaId,
						pageNumber,
						JSON.stringify(itemTranslateNameChunk),
						translateId,
					]);
				}
			}
			// console.log('lp', insertValues)
			await mysql_con.query(gacha_history_insert_query, [insertValues]);
		}

		await mysql_con.commit();

		// lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
		let invokeParams = {
			FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
			InvocationType: "RequestResponse",
		};
		// invoke lambda
		let result = await lambda.invoke(invokeParams).promise();
		if (result.$response.error) throw (500, result.$response.error.message);

		return {
			statusCode: 200,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: JSON.stringify({ result: "success" }),
		};
	} catch (error) {
		await mysql_con.rollback();
		console.log(error);
		// await mysql_con.rollback();
		return {
			statusCode: 400,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: JSON.stringify({
				errorCode: Number(error.message),
			}),
		};
	} finally {
		if (mysql_con) await mysql_con.close();
	}
};

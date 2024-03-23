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
	const redisConfig = [
		{ host: process.env.REDISPOINT1, port: 6379 },
		{ host: process.env.REDISPOINT2, port: 6379 },
	];
	const cluster = new redis.Cluster(redisConfig, {
		dnsLookup: (address, callback) => callback(null, address),
		redisOptions: { tls: true },
	});

	const gachaId = event;
	let mysql_con;

	console.log('incoming gacha id', gachaId)

	try {
		// mysql connect
		mysql_con = await mysql.createConnection(writeDbConfig);
		await mysql_con.beginTransaction();

		// ステータスが5の場合、1に変更する
		let statusSQL = `SELECT gachaId FROM Gacha WHERE gachaId = ?`;
		const [gachaStatusResult] = await mysql_con.execute(statusSQL, [gachaId]);

		//Update DB status
		let update_sql = `UPDATE Gacha SET gachaDeployStatus = ? WHERE gachaId = ?`;
		await mysql_con.execute(update_sql, [1, gachaId]);

		for (const row of gachaStatusResult) {
			const { gachaId } = row || {};

			// 念の為Redisから削除する
			await cluster.del("gacha:" + ENVID + ":" + gachaId + ":list");
			await cluster.del("gacha:" + ENVID + ":" + gachaId + ":limit:list");

			// emissionをlistに書き出す
			const count = `SELECT COUNT(*) AS cnt FROM GachaEmission WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder > 0`;
			let [gachaCount] = await mysql_con.query(count, [gachaId]);
			console.log("gacha count = ", gachaCount[0].cnt);
			// ループ
			let k = 0;
			let l = 100000;
			const chunkLength = Math.ceil(gachaCount[0].cnt / l);

			console.time('xxx---3')
			// 1000件ずつ格納
			for (let i = 1; i <= chunkLength; i++) {
				console.time('----------1')
				const gachaData = `
				SELECT 
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
					gachaEmissionPrizeId
				FROM GachaEmission
				LEFT OUTER JOIN GachaPrize AS GP1 ON gachaEmissionPrizeId = GP1.gachaPrizeId
				LEFT OUTER JOIN GachaPrize AS GP2 ON gachaEmissionBonusPrizeId = GP2.gachaPrizeId
				WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder > 0
				ORDER BY gachaEmissionOrder LIMIT ?, ?`;
				// console.log("@@@@@ i = ", i);
				// console.log("@@@@ k = ", k);
				// console.log("@@@@ l = ", l);
				let [gachaResult] = await mysql_con.query(gachaData, [gachaId, k, l]);

				const pipeline = cluster.pipeline();
				for (let j = 0; j < gachaResult.length; j++) {
					let videoId;
					if (gachaResult[j].order2 == null || gachaResult[j].order1 < gachaResult[j].order2) {
						videoId = gachaResult[j].gachaEmissionVideoId;
					} else {
						videoId = gachaResult[j].gachaEmissionBonusVideoId;
					}
					// console.log("gachaResult[j].order1", gachaResult[j].order1);
					// console.log("gachaResult[j].order2", gachaResult[j].order2);
					// console.log("gachaResult[j].gachaEmissionVideoId", gachaResult[j].gachaEmissionVideoId);
					// console.log("gachaResult[j].gachaEmissionBonusVideoId", gachaResult[j].gachaEmissionBonusVideoId);
					// console.log("videoId", videoId);
					const gachaEmissionItemId = gachaResult[j].gachaEmissionItemId;
					const gachaEmissionBonusItemId = gachaResult[j].gachaEmissionBonusItemId;

					let itemData = {
						eid: gachaResult[j].gachaEmissionId,
						ii: gachaEmissionItemId, // itemId
						ip: gachaResult[j].gachaEmissionItemPoint, // itemPoint
						bi: gachaEmissionBonusItemId, // bonusItemId
						bp: gachaResult[j].gachaEmissionBonusItemPoint, // bonusPoint
						vi: videoId, // videoId
						vp: gachaResult[j].gachaEmissionVideoPriority, // bonusVideoId
						// uuid: gachaResult[j].gachaEmissionUUID, // uuid
						pi: gachaResult[j].gachaEmissionPrizeId
					};

					pipeline.rpush("gacha:" + ENVID + ":" + gachaId + ":list", JSON.stringify(itemData));
				}
				await pipeline.exec();

				k += l;
				console.log("xxx---2", k);
				console.timeEnd('----------1')
			}

			console.log("xxx---3");
			console.timeEnd('xxx---3')

			// 天井賞のRedis出力 TODO
			const gachaLimitData = `
			SELECT 
				gachaEmissionId,
				gachaEmissionBonusItemId,
				gachaEmissionBonusItemPoint,
				gachaEmissionBonusVideoId,
				gachaEmissionVideoPriority
			FROM GachaEmission
			LEFT OUTER JOIN GachaPrize AS GP1 ON gachaEmissionPrizeId = GP1.gachaPrizeId
			LEFT OUTER JOIN GachaPrize AS GP2 ON gachaEmissionBonusPrizeId = GP2.gachaPrizeId
			WHERE gachaEmissionGachaId = ? AND gachaEmissionOrder = 0 ORDER BY gachaEmissionLimitOrder`;
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

				pipeline2.rpush("gacha:" + ENVID + ":" + gachaId + ":limit:list", JSON.stringify(itemData));
			}
			await pipeline2.exec();
		}

		// １に変更する
		let updateSQL = `UPDATE Gacha SET gachaStatus = 1, gachaRemainingCount = gachaTotalCount, gachaDeployStatus = 0 WHERE gachaId = ?`;
		await mysql_con.execute(updateSQL, [gachaId]);

		await mysql_con.commit();

		// lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
		let invokeParams = {
			FunctionName: "SystemRedisGachaExport-" + process.env.ENV,
			InvocationType: "RequestResponse",
		};
		// invoke lambda
		let result = await lambda.invoke(invokeParams).promise();
		if (result.$response.error) throw (500, result.$response.error.message);

/* TATSU 20240129 DEL START Do not create history when deploying */
//		// lambdaを起動 ガチャデータのRedisへの出力（順番も生成される）
//		let invokeParams1 = {
//			FunctionName: "InvokeOripaHistoryGenereateProcess-" + process.env.ENV,
//			InvocationType: "Event",
//			Payload: String(gachaId)
//		};
//		// invoke lambda
//		let result1 = await lambda.invoke(invokeParams1).promise();
//		if (result1.$response.error) throw (500, result1.$response.error.message);
/* TATSU 20240129 DEL END   Do not create history when deploying */

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

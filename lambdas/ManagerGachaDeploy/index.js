/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

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
	}

	// Database info
	const writeDbConfig = {
		host: process.env.DBWRITEENDPOINT,
		user: process.env.DBUSER,
		password: process.env.DBPASSWORD,
		database: process.env.DBDATABSE,
		charset: process.env.DBCHARSET,
		multipleStatements: true,
	};

	let mysql_con;
	const { pathParameters: { gachaId = 0 } } = event || {};

	try {
		if (!gachaId) return getResponse({ message: "gachaId is missing in pathParameters." }, 507);

		// mysql connect
		mysql_con = await mysql.createConnection(writeDbConfig);

		// ステータスが5の場合、1に変更する
		let statusSQL = `SELECT * FROM Gacha WHERE gachaId = ? AND gachaStatus = 5`;
		const [gachaStatusResult] = await mysql_con.query(statusSQL, [gachaId]);

		// ステータスが5以外の場合この先に進めない
		if (gachaStatusResult.length == 0) {
			console.log("status failure! not found with status 5", gachaId);
			throw new Error(507);
		}

		//Update DB status
		let update_sql = `UPDATE Gacha SET gachaDeployStatus = ? WHERE gachaId = ?`;
		await mysql_con.execute(update_sql, [2, gachaId]);

		let invokeParams = {
			FunctionName: "ManagerGachaDeployProcess-" + process.env.ENV,
			InvocationType: "Event",
			Payload: String(gachaId)
		};
		// invoke lambda
		let result = await lambda.invoke(invokeParams).promise();
		if (result.$response.error) throw (500, result.$response.error.message);

		console.log("Lambda invoked successfully");

		return getResponse("start gacha build", 200);
	} catch (error) {
		console.log(error);
		return getResponse(error, 400);
	} finally {
		if (mysql_con) await mysql_con.close();
	}

	function getResponse(data, statusCode = 200) {
		return {
			statusCode,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: JSON.stringify(data),
		};
	}
};

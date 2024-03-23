/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const { v4: uuidv4 } = require("uuid");

process.env.TZ = "Asia/Tokyo";

const sqs = new AWS.SQS();
const queueUrl = `https://sqs.ap-northeast-1.amazonaws.com/225702177590/GachaBuildSQS-${process.env.ENV}.fifo`;

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

  const {
    pathParameters: { gachaId = 0 },
  } = event || {};

  const params = {
    MessageBody: `${gachaId}`,
    QueueUrl: queueUrl,
    MessageGroupId: "GACHA_BUILD",
    MessageDeduplicationId: uuidv4(),
  };

  try {
    if (!gachaId) {
      console.log("gacha");
      return getResponse(
        { message: "gachaId is missing in pathParameters." },
        507
      );
    }

    // mysql connect
    mysql_con = await mysql.createConnection(writeDbConfig);

    const sqsResult = await sqs.sendMessage(params).promise();
    if (!sqsResult) {
      console.error("SQS発行エラー");
      throw new Error("sqs failure!");
    }
    console.log("Message published successfully");
    // You can handle the callback if required

    //Update DB status
    let update_sql = `UPDATE Gacha SET gachaBuildStatus = ?, gachaRemainingCount = ? WHERE gachaId = ?`;
    await mysql_con.execute(update_sql, [2, null, gachaId]);
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

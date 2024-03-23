/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
process.env.TZ = 'Asia/Tokyo';
//const common = require('./commonFunctions/checkFilter')
/**
 * ManagerFileUploadS3.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;

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
    }
    // Database info
    let writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };
    console.log('jsonBody1', event.body);
    // let jsonBody =  await multipart.parse(event);
    console.log('body',JSON.parse(event.body));
    const {
        uploadedFile,
        file_name,
        bucketName,
        distination_directory,
    } = JSON.parse(event.body);

    const createdAt = Math.floor(new Date().getTime() / 1000);
  
    try {
        console.log("uploadedFile2", Buffer.from(uploadedFile, 'base64'));
        let fileBody = Buffer.from(uploadedFile, 'base64');
        console.log('fileBody',fileBody);
        let filePath = distination_directory+file_name;
        console.log('filePath', filePath);
        console.log('file_name', file_name);
        let fileUploaded = await s3.putObject({
            Bucket: bucketName,
            Key: filePath,
            Body: fileBody,
            ContentType: "image/jpeg",
        }).promise();
        console.log('fileUploaded', fileUploaded);
        if (!fileUploaded) {
            console.log("failure file upload");
            // failure log
            // await createLog(context, 'csvImportTemplate', 'create', 'failure', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "no data"
                }),
            };
        }
        const { LocationConstraint = 'ap-northeast-1' } = await s3.getBucketLocation({ Bucket: bucketName }).promise();
        // construct the response
        let response = {
            fileUploadedInfo: fileUploaded
        };
        fileUploaded['location'] = `https://${bucketName}.s3.${LocationConstraint}.amazonaws.com/${filePath}`;//fileUploaded?.Location;
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(fileUploaded),
        };
    } catch (error) {
        
        console.log(error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }
};
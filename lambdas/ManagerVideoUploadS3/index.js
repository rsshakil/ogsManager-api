/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

/**
 * ManagerFileUploadS3.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
    const { operation, fileName, bucketName, chunkSize = 0, uploadId } = JSON.parse(event.body);

    try {
        if (operation === 'initiate') {
            try {
                const multipartParams = {
                    Bucket: bucketName,
                    Key: fileName,
                };
                const multipartUpload = await s3.createMultipartUpload(multipartParams).promise();
                const response = {
                    uploadId: multipartUpload.UploadId,
                    key: fileName,
                    presignedUrls: generatePresignedUrls(multipartUpload.UploadId, fileName),
                };

                return getResponse(response, 200);

            } catch (err) {
                console.error('Error initiating multipart upload', err);
                return getResponse(err, 400);
            }
        }
        else if (operation === 'complete') {
            const parts = await s3.listParts({ Bucket: bucketName, Key: fileName, UploadId: uploadId }).promise();

            const completeParams = {
                Bucket: bucketName,
                Key: fileName,
                MultipartUpload: {
                    Parts: parts.Parts.map(part => ({ PartNumber: part.PartNumber, ETag: part.ETag })),
                },
                UploadId: uploadId,
            };

            try {
                const result = await s3.completeMultipartUpload(completeParams).promise();

                return getResponse({ message: 'Multipart upload completed successfully', data: result }, 200);

            } catch (err) {
                console.error('Error completing multipart upload', err);
                return getResponse(err, 400);
            }
        }
        else {
            return getResponse({ message: 'Invalid operation' }, 400);
        }
    } catch (error) {
        console.log('error occurred:::----->', error);
        return getResponse(error, 400);
    }

    function generatePresignedUrls(uploadId, fileName) {
        const presignedUrls = [];
        const numberOfParts = chunkSize; // Number of parts for the large file

        for (let i = 0; i < numberOfParts; i++) {
            const params = {
                Bucket: bucketName,
                Key: fileName,
                PartNumber: i + 1,
                UploadId: uploadId,
                Expires: 3600  //1hour
            };
            const url = s3.getSignedUrl('uploadPart', params);
            presignedUrls.push(url);
        }

        return presignedUrls;
    }

    function getResponse(data, statusCode = 200) {
        return {
            statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(data),
        }
    }
};
#!/bin/sh
set -eu
DLQ_ARN="$(awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true --query QueueUrl --output text | xargs -I '{}' awslocal sqs get-queue-attributes --queue-url '{}' --attribute-names QueueArn --query Attributes.QueueArn --output text)"
awslocal sqs create-queue --queue-name wager-transactions.fifo --attributes "{\"FifoQueue\":\"true\",\"VisibilityTimeout\":\"30\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null
awslocal sqs create-queue --queue-name wager-events.fifo --attributes FifoQueue=true >/dev/null

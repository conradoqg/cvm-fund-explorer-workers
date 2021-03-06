#!/bin/bash

set -e

IMAGE=cvm-fund-explorer-workers

docker build -t $IMAGE .

if [ -n "$TRAVIS_BRANCH" ]; then
    echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
    docker tag $IMAGE $DOCKER_USERNAME/$IMAGE:${TRAVIS_BRANCH//[\/ ]/-}
    docker push $DOCKER_USERNAME/$IMAGE:${TRAVIS_BRANCH//[\/ ]/-}

    if [ "$TRAVIS_BRANCH" = "master" ]; then        
        docker tag $IMAGE $DOCKER_USERNAME/$IMAGE:latest
        docker push $DOCKER_USERNAME/$IMAGE:latest
    fi
else
    if [ -n "$BRANCH" ]; then
        docker tag $IMAGE conradoqg/$IMAGE:local
    else
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        docker tag $IMAGE conradoqg/$IMAGE:${BRANCH//[\/ ]/-}
        if [ "$BRANCH" = "master" ]; then
            docker tag $IMAGE conradoqg/$IMAGE:latest
        fi
    fi
fi

docker images
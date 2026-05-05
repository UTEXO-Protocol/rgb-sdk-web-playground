# Makefile Variables.
include config.mk

# Docker BuildKit.
export DOCKER_BUILDKIT=1

.PHONY: build push docker help

build: ## Build rgb-sdk-web-playground docker image.
	docker build -f ./Dockerfile -t $(IMAGE_RGB_SDK_WEB_PLAYGROUND_BACKUP) -t $(IMAGE_RGB_SDK_WEB_PLAYGROUND_LATEST) .

push: ## Push rgb-sdk-web-playground docker image.
	docker push $(IMAGE_RGB_SDK_WEB_PLAYGROUND_BACKUP) && \
	docker push $(IMAGE_RGB_SDK_WEB_PLAYGROUND_LATEST)

docker: ## Build and push docker images.
	make build push

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

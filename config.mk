# Variables.
ENVIRONMENT             ?=
IMAGE_TAG               ?= latest
REGISTRY_HOST           ?= ghcr.io/utexo-protocol
CURRENT_DATE_TIME       := $(shell date +'%Y-%m-%d')
LATEST_COMMIT           := $$(git rev-parse --short HEAD)

# Image names.
RGB_SDK_WEB_PLAYGROUND_IMAGE := rgb-sdk-web-playground

# Variables for build.
IMAGE_RGB_SDK_WEB_PLAYGROUND_BACKUP = $(REGISTRY_HOST)/$(RGB_SDK_WEB_PLAYGROUND_IMAGE)$(ENVIRONMENT):$(CURRENT_DATE_TIME)-$(LATEST_COMMIT)
IMAGE_RGB_SDK_WEB_PLAYGROUND_LATEST = $(REGISTRY_HOST)/$(RGB_SDK_WEB_PLAYGROUND_IMAGE)$(ENVIRONMENT):$(IMAGE_TAG)

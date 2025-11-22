# WASM 3.0 Compatibility - Emscripten Version Matrix
#
# Tested Versions:
#   - 3.1.43, 3.1.44: Working (CloudFlare compatible)
#   - 3.1.45-3.1.67: CloudFlare Workers issues (general WASM works)
#   - 3.1.74+: Latest stable (testing in progress)
#
# To build with a specific version:
#   docker build --build-arg EMSDK_VERSION=3.1.74 -t php-emscripten-builder .
#
# Version Categories:
#   STABLE_CLOUDFLARE = 3.1.44 (best CloudFlare compatibility)
#   STABLE_MODERN = 3.1.67 (current default)
#   LATEST = 3.1.74 (newest features, needs testing)

ARG EMSDK_VERSION="3.1.67"
ARG EMSDK_FALLBACK_VERSION="3.1.44"
FROM emscripten/emsdk:${EMSDK_VERSION}

MAINTAINER Sean Morris <sean@seanmorr.is>

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

RUN apt-get update; \
	DEBIAN_FRONTEND=noninteractive \
	apt-get --no-install-recommends -y install \
		build-essential \
		automake \
		autoconf \
		autogen \
		libtool \
		gettext \
		shtool \
		brotli \
		pkgconf \
		gperf \
		groff \
		bison \
		flex \
		gzip \
		make \
		re2c \
		gdb \
		git \
		sed \
		pv \
		jq

# RUN rm -rf /emsdk/upstream/emscripten
# ADD emscripten /emsdk/upstream/emscripten
# RUN /emsdk/upstream/emscripten/bootstrap

RUN cd /emsdk/upstream && {\
	rm -rf emscripten;\
	git clone https://github.com/seanmorris/emscripten.git emscripten --depth=1 --branch sm-updates;\
	emscripten/bootstrap; \
}

RUN embuilder build USER

RUN emcc --check

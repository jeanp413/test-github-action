FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    wget \
    bzip2 \
    ca-certificates \
    curl \
    git \
    gnupg2 \
    software-properties-common \
    python3.10 \
    python3.10-venv \
    python3.10-dev \
    python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install CUDA 12.4 for A10G GPU (Ampere architecture)
RUN wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb \
    && dpkg -i cuda-keyring_1.1-1_all.deb \
    && rm cuda-keyring_1.1-1_all.deb \
    && add-apt-repository "deb https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/ /" \
    && apt-get update \
    && apt-get -y install --no-install-recommends cuda-toolkit-12-4 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set CUDA environment variables
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64

# Create a Python virtual environment
RUN python3.10 -m venv /workspaces/venv
ENV PATH=/workspaces/venv/bin:${PATH}

# Install PyTorch 2.5.0 with CUDA 12.4 support
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --upgrade setuptools \
    && pip install --no-cache-dir torch==2.5.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# Install Unsloth with CUDA 12.4 support for Ampere architecture
RUN pip install --no-build-isolation --no-deps --no-cache-dir "unsloth[cu124-ampere-torch250] @ git+https://github.com/unslothai/unsloth.git"

# Install Jupyter
RUN pip install --no-cache-dir jupyter

# Install all dependencies from requirements.txt to ensure nothing is missing
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

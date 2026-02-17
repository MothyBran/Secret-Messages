#!/bin/bash
# Install Tor if not present
if ! command -v tor &> /dev/null
then
    echo "Tor could not be found, attempting install..."
    if command -v apt-get &> /dev/null; then
        if command -v sudo &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y tor
        else
            apt-get update
            apt-get install -y tor
        fi
    elif command -v apk &> /dev/null; then
        if command -v sudo &> /dev/null; then
            sudo apk update
            sudo apk add tor
        else
            apk update
            apk add tor
        fi
    else
        echo "Error: Package manager not found. Please install Tor manually."
        exit 1
    fi
else
    echo "Tor is already installed."
fi

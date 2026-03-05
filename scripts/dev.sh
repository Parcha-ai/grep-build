#!/bin/bash

# Generate a unique dev instance name
ADJECTIVES=("fuzzy" "sparkly" "bouncy" "wobbly" "zippy" "snazzy" "groovy" "jazzy" "perky" "zesty" "quirky" "peppy" "spiffy" "nifty" "dandy" "swanky" "cheeky" "plucky" "snappy" "frisky" "giddy" "jolly" "chipper" "dapper")
NOUNS=("penguin" "tiger" "otter" "panda" "koala" "badger" "ferret" "wombat" "platypus" "narwhal" "capybara" "axolotl" "quokka" "lemur" "meerkat" "hedgehog" "sloth" "mongoose" "armadillo" "chinchilla" "ocelot" "tapir")

ADJ_IDX=$((RANDOM % ${#ADJECTIVES[@]}))
NOUN_IDX=$((RANDOM % ${#NOUNS[@]}))

export DEV_INSTANCE_NAME="${ADJECTIVES[$ADJ_IDX]}-${NOUNS[$NOUN_IDX]}"

echo ""
echo "========================================"
echo "  DEV INSTANCE: $DEV_INSTANCE_NAME"
echo "========================================"
echo ""

# Setup QMD (downloads Bun + QMD for current platform if not already present)
echo "Setting up QMD..."
npm run setup-qmd
echo ""

# Kill any existing process on port 9000
lsof -ti:9000 | xargs kill -9 2>/dev/null || true

# Use a separate user data directory for dev so it doesn't touch production data
export GREP_DEV_USER_DATA="/tmp/grep-build-dev"
mkdir -p "$GREP_DEV_USER_DATA"

# Start the dev server with the instance name
npm run start

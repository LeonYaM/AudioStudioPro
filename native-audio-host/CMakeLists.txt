cmake_minimum_required(VERSION 3.22)
project(AudioStudioNativeHost VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
  JUCE
  URL https://github.com/juce-framework/JUCE/archive/refs/tags/8.0.4.zip
)
FetchContent_MakeAvailable(JUCE)

# Optional Steinberg ASIO SDK path: pass -DASIO_SDK_DIR="C:/SDKs/asiosdk"
set(ASIO_FLAG 0)
if(DEFINED ASIO_SDK_DIR AND EXISTS "${ASIO_SDK_DIR}/common/asio.h")
  set(ASIO_FLAG 1)
  include_directories("${ASIO_SDK_DIR}/common" "${ASIO_SDK_DIR}/host" "${ASIO_SDK_DIR}/host/pc")
endif()

juce_add_console_app(audio-studio-native-host
  PRODUCT_NAME "Audio Studio Native Host"
)

target_sources(audio-studio-native-host PRIVATE
  src/main.cpp
)

target_compile_definitions(audio-studio-native-host PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_ASIO=${ASIO_FLAG}
  JUCE_WASAPI=1
  JUCE_DIRECTSOUND=1
  JUCE_PLUGINHOST_VST3=1
)

target_link_libraries(audio-studio-native-host PRIVATE
  juce::juce_audio_basics
  juce::juce_audio_devices
  juce::juce_audio_formats
  juce::juce_audio_processors
  juce::juce_core
  juce::juce_events
)

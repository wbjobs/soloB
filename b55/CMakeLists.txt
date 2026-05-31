cmake_minimum_required(VERSION 3.10)
project(PhysicsSandbox CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

find_package(SDL2 REQUIRED)

include_directories(${SDL2_INCLUDE_DIRS})
include_directories(${CMAKE_SOURCE_DIR}/src)

file(GLOB SOURCES
    "src/*.cpp"
)

add_executable(PhysicsSandbox ${SOURCES})
target_link_libraries(PhysicsSandbox ${SDL2_LIBRARIES})

cmake_minimum_required(VERSION 3.10)
project(LevenbergMarquardtLib)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(levenberg_marquardt SHARED
    levenberg_marquardt.cpp
    levenberg_marquardt.h
)

if(WIN32)
    target_compile_definitions(levenberg_marquardt PRIVATE LEVENBERG_MARQUARDT_EXPORTS)
endif()

set_target_properties(levenberg_marquardt PROPERTIES
    OUTPUT_NAME "levenberg_marquardt"
    WINDOWS_EXPORT_ALL_SYMBOLS OFF
)

if(UNIX AND NOT APPLE)
    target_link_libraries(levenberg_marquardt PRIVATE m)
    set_target_properties(levenberg_marquardt PROPERTIES
        SOVERSION 1
    )
    add_custom_command(TARGET levenberg_marquardt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E create_symlink
            $<TARGET_SONAME_FILE_NAME:levenberg_marquardt>
            ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/libfit.so
    )
endif()

if(WIN32)
    add_custom_command(TARGET levenberg_marquardt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:levenberg_marquardt>
            ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/fit.dll
    )
endif()

install(TARGETS levenberg_marquardt
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(FILES levenberg_marquardt.h DESTINATION include)

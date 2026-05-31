#ifndef LEVENBERG_MARQUARDT_H
#define LEVENBERG_MARQUARDT_H

#include <vector>
#include <string>
#include <functional>

#ifdef _WIN32
    #ifdef LEVENBERG_MARQUARDT_EXPORTS
        #define LM_API __declspec(dllexport)
    #else
        #define LM_API __declspec(dllimport)
    #endif
#else
    #define LM_API __attribute__((visibility("default")))
#endif

using FuncType = std::function<double(double, const std::vector<double>&)>;
using GradientFunc = std::function<std::vector<double>(double, const std::vector<double>&)>;

struct FitResult {
    std::vector<double> params;
    double chi_squared;
    int iterations;
    std::string error_message;
    bool success;
};

class LevenbergMarquardt {
public:
    LevenbergMarquardt();
    
    FitResult fit(
        const std::vector<double>& x,
        const std::vector<double>& y,
        const std::vector<double>& initial_params,
        FuncType func,
        GradientFunc gradient = nullptr
    );
    
    void set_max_iterations(int max_iter);
    void set_tolerance(double tol);
    void set_lambda_init(double lambda);
    
private:
    int max_iterations_;
    double tolerance_;
    double lambda_init_;
    
    double compute_chi_squared(
        const std::vector<double>& x,
        const std::vector<double>& y,
        const std::vector<double>& params,
        FuncType func
    );
    
    std::vector<double> compute_residuals(
        const std::vector<double>& x,
        const std::vector<double>& y,
        const std::vector<double>& params,
        FuncType func
    );
    
    std::vector<std::vector<double>> compute_jacobian(
        const std::vector<double>& x,
        const std::vector<double>& params,
        FuncType func,
        GradientFunc gradient
    );
    
    std::vector<double> numerical_gradient(
        double x,
        const std::vector<double>& params,
        FuncType func
    );
    
    std::vector<double> solve_linear_system(
        const std::vector<std::vector<double>>& A,
        const std::vector<double>& b
    );
};

extern "C" {
    struct LM_API C_FitResult {
        double* params;
        int param_count;
        double chi_squared;
        int iterations;
        char* error_message;
        int success;
    };
    
    LM_API C_FitResult* fit_curve(
        const double* x,
        const double* y,
        int data_size,
        const double* initial_params,
        int param_count,
        const char* func_expression
    );
    
    LM_API void free_fit_result(C_FitResult* result);
}

#endif

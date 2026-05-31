#include "levenberg_marquardt.h"
#include <cmath>
#include <iostream>
#include <map>
#include <sstream>
#include <cstring>
#include <cstdlib>

LevenbergMarquardt::LevenbergMarquardt()
    : max_iterations_(200), tolerance_(1e-8), lambda_init_(0.01) {}

void LevenbergMarquardt::set_max_iterations(int max_iter) {
    max_iterations_ = max_iter;
}

void LevenbergMarquardt::set_tolerance(double tol) {
    tolerance_ = tol;
}

void LevenbergMarquardt::set_lambda_init(double lambda) {
    lambda_init_ = lambda;
}

double LevenbergMarquardt::compute_chi_squared(
    const std::vector<double>& x,
    const std::vector<double>& y,
    const std::vector<double>& params,
    FuncType func) {
    
    double chi2 = 0.0;
    for (size_t i = 0; i < x.size(); ++i) {
        double diff = y[i] - func(x[i], params);
        chi2 += diff * diff;
    }
    return chi2;
}

std::vector<double> LevenbergMarquardt::compute_residuals(
    const std::vector<double>& x,
    const std::vector<double>& y,
    const std::vector<double>& params,
    FuncType func) {
    
    std::vector<double> residuals(x.size());
    for (size_t i = 0; i < x.size(); ++i) {
        residuals[i] = y[i] - func(x[i], params);
    }
    return residuals;
}

std::vector<double> LevenbergMarquardt::numerical_gradient(
    double x,
    const std::vector<double>& params,
    FuncType func) {
    
    const double eps = 1e-8;
    std::vector<double> grad(params.size());
    
    for (size_t j = 0; j < params.size(); ++j) {
        std::vector<double> p_plus = params;
        std::vector<double> p_minus = params;
        
        double h = std::abs(params[j]) * eps;
        if (h < eps) h = eps;
        
        p_plus[j] += h;
        p_minus[j] -= h;
        
        grad[j] = (func(x, p_plus) - func(x, p_minus)) / (2.0 * h);
    }
    return grad;
}

std::vector<std::vector<double>> LevenbergMarquardt::compute_jacobian(
    const std::vector<double>& x,
    const std::vector<double>& params,
    FuncType func,
    GradientFunc gradient) {
    
    std::vector<std::vector<double>> jacobian(x.size(), std::vector<double>(params.size()));
    
    for (size_t i = 0; i < x.size(); ++i) {
        if (gradient) {
            std::vector<double> grad = gradient(x[i], params);
            for (size_t j = 0; j < params.size(); ++j) {
                jacobian[i][j] = -grad[j];
            }
        } else {
            std::vector<double> grad = numerical_gradient(x[i], params, func);
            for (size_t j = 0; j < params.size(); ++j) {
                jacobian[i][j] = -grad[j];
            }
        }
    }
    return jacobian;
}

std::vector<double> LevenbergMarquardt::solve_linear_system(
    const std::vector<std::vector<double>>& A,
    const std::vector<double>& b) {
    
    int n = A.size();
    std::vector<std::vector<double>> L = A;
    std::vector<double> x = b;
    
    for (int i = 0; i < n; ++i) {
        int pivot = i;
        for (int j = i + 1; j < n; ++j) {
            if (std::abs(L[j][i]) > std::abs(L[pivot][i])) {
                pivot = j;
            }
        }
        std::swap(L[i], L[pivot]);
        std::swap(x[i], x[pivot]);
        
        for (int j = i + 1; j < n; ++j) {
            double factor = L[j][i] / L[i][i];
            for (int k = i; k < n; ++k) {
                L[j][k] -= factor * L[i][k];
            }
            x[j] -= factor * x[i];
        }
    }
    
    for (int i = n - 1; i >= 0; --i) {
        for (int j = i + 1; j < n; ++j) {
            x[i] -= L[i][j] * x[j];
        }
        x[i] /= L[i][i];
    }
    
    return x;
}

FitResult LevenbergMarquardt::fit(
    const std::vector<double>& x,
    const std::vector<double>& y,
    const std::vector<double>& initial_params,
    FuncType func,
    GradientFunc gradient) {
    
    FitResult result;
    result.params = initial_params;
    result.success = false;
    result.iterations = 0;
    result.chi_squared = 0.0;
    
    if (x.empty() || y.empty()) {
        result.error_message = "Empty input data";
        return result;
    }
    
    if (x.size() != y.size()) {
        result.error_message = "x and y sizes mismatch";
        return result;
    }
    
    if (initial_params.empty()) {
        result.error_message = "No initial parameters provided";
        return result;
    }
    
    int m = x.size();
    int n = initial_params.size();
    std::vector<double> params = initial_params;
    
    double lambda = lambda_init_;
    double chi2 = compute_chi_squared(x, y, params, func);
    double chi2_new = chi2;
    
    for (int iter = 0; iter < max_iterations_; ++iter) {
        result.iterations = iter + 1;
        
        auto jacobian = compute_jacobian(x, params, func, gradient);
        auto residuals = compute_residuals(x, y, params, func);
        
        std::vector<std::vector<double>> JTJ(n, std::vector<double>(n, 0.0));
        std::vector<double> JTr(n, 0.0);
        
        for (int i = 0; i < m; ++i) {
            for (int j = 0; j < n; ++j) {
                JTr[j] += jacobian[i][j] * residuals[i];
                for (int k = 0; k < n; ++k) {
                    JTJ[j][k] += jacobian[i][j] * jacobian[i][k];
                }
            }
        }
        
        bool found = false;
        while (!found && lambda > 1e-12) {
            auto JTJ_mod = JTJ;
            for (int j = 0; j < n; ++j) {
                JTJ_mod[j][j] *= (1.0 + lambda);
            }
            
            std::vector<double> delta;
            try {
                delta = solve_linear_system(JTJ_mod, JTr);
            } catch (...) {
                lambda *= 10.0;
                continue;
            }
            
            std::vector<double> new_params(n);
            for (int j = 0; j < n; ++j) {
                new_params[j] = params[j] - delta[j];
            }
            
            chi2_new = compute_chi_squared(x, y, new_params, func);
            
            if (chi2_new <= chi2 * (1.0 + 1e-10)) {
                params = new_params;
                chi2 = chi2_new;
                lambda /= 10.0;
                found = true;
            } else {
                lambda *= 10.0;
            }
        }
        
        double param_change = 0.0;
        for (double d : JTr) {
            param_change += std::abs(d);
        }
        
        if (param_change < tolerance_ * n || found == false) {
            result.success = true;
            break;
        }
    }
    
    result.params = params;
    result.chi_squared = chi2;
    if (result.iterations >= max_iterations_) {
        result.error_message = "Maximum iterations reached";
    } else {
        result.error_message = "";
    }
    
    return result;
}

class FuncExpressionParser {
public:
    FuncExpressionParser(const std::string& expr) : expr_(expr), pos_(0) {}
    
    FuncType parse() {
        auto ast = parse_expression();
        return [ast](double x, const std::vector<double>& params) {
            std::map<char, double> vars;
            vars['x'] = x;
            for (size_t i = 0; i < params.size(); ++i) {
                if (i == 0) vars['a'] = params[i];
                else if (i == 1) vars['b'] = params[i];
                else if (i == 2) vars['c'] = params[i];
                else if (i == 3) vars['d'] = params[i];
                else vars['e'] = params[i];
            }
            return ast->evaluate(vars);
        };
    }
    
    int get_param_count() {
        std::string lower = expr_;
        for (char& c : lower) c = tolower(c);
        
        int max_param = 0;
        for (char c : lower) {
            if (c >= 'a' && c <= 'e') {
                max_param = std::max(max_param, c - 'a' + 1);
            }
        }
        return max_param;
    }

private:
    struct Node {
        virtual ~Node() = default;
        virtual double evaluate(const std::map<char, double>& vars) const = 0;
    };
    
    struct NumberNode : Node {
        double value;
        NumberNode(double v) : value(v) {}
        double evaluate(const std::map<char, double>& vars) const override {
            return value;
        }
    };
    
    struct VariableNode : Node {
        char name;
        VariableNode(char n) : name(n) {}
        double evaluate(const std::map<char, double>& vars) const override {
            auto it = vars.find(tolower(name));
            if (it != vars.end()) return it->second;
            if (tolower(name) == 'e') return M_E;
            return 0.0;
        }
    };
    
    struct BinaryOpNode : Node {
        char op;
        Node* left;
        Node* right;
        BinaryOpNode(char o, Node* l, Node* r) : op(o), left(l), right(r) {}
        ~BinaryOpNode() { delete left; delete right; }
        double evaluate(const std::map<char, double>& vars) const override {
            double l = left->evaluate(vars);
            double r = right->evaluate(vars);
            switch (op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
                case '^': return std::pow(l, r);
                default: return 0.0;
            }
        }
    };
    
    struct FunctionNode : Node {
        std::string func;
        Node* arg;
        FunctionNode(const std::string& f, Node* a) : func(f), arg(a) {}
        ~FunctionNode() { delete arg; }
        double evaluate(const std::map<char, double>& vars) const override {
            double x = arg->evaluate(vars);
            if (func == "exp") return std::exp(x);
            if (func == "log") return std::log(x);
            if (func == "sin") return std::sin(x);
            if (func == "cos") return std::cos(x);
            if (func == "tan") return std::tan(x);
            if (func == "sqrt") return std::sqrt(x);
            return 0.0;
        }
    };
    
    std::string expr_;
    size_t pos_;
    
    void skip_whitespace() {
        while (pos_ < expr_.size() && std::isspace(expr_[pos_])) pos_++;
    }
    
    Node* parse_expression() {
        Node* left = parse_term();
        while (pos_ < expr_.size()) {
            skip_whitespace();
            if (expr_[pos_] == '+' || expr_[pos_] == '-') {
                char op = expr_[pos_++];
                Node* right = parse_term();
                left = new BinaryOpNode(op, left, right);
            } else {
                break;
            }
        }
        return left;
    }
    
    Node* parse_term() {
        Node* left = parse_factor();
        while (pos_ < expr_.size()) {
            skip_whitespace();
            if (expr_[pos_] == '*' || expr_[pos_] == '/') {
                char op = expr_[pos_++];
                Node* right = parse_factor();
                left = new BinaryOpNode(op, left, right);
            } else {
                break;
            }
        }
        return left;
    }
    
    Node* parse_factor() {
        Node* left = parse_power();
        while (pos_ < expr_.size()) {
            skip_whitespace();
            if (expr_[pos_] == '^') {
                pos_++;
                Node* right = parse_factor();
                left = new BinaryOpNode('^', left, right);
            } else {
                break;
            }
        }
        return left;
    }
    
    Node* parse_power() {
        skip_whitespace();
        
        if (expr_[pos_] == '-') {
            pos_++;
            Node* child = parse_power();
            return new BinaryOpNode('*', new NumberNode(-1.0), child);
        }
        
        if (expr_[pos_] == '(') {
            pos_++;
            Node* node = parse_expression();
            skip_whitespace();
            if (pos_ < expr_.size() && expr_[pos_] == ')') pos_++;
            return node;
        }
        
        if (std::isalpha(expr_[pos_])) {
            size_t start = pos_;
            while (pos_ < expr_.size() && std::isalpha(expr_[pos_])) pos_++;
            std::string name = expr_.substr(start, pos_ - start);
            
            skip_whitespace();
            if (pos_ < expr_.size() && expr_[pos_] == '(') {
                pos_++;
                Node* arg = parse_expression();
                skip_whitespace();
                if (pos_ < expr_.size() && expr_[pos_] == ')') pos_++;
                return new FunctionNode(name, arg);
            }
            
            if (name.size() == 1) {
                return new VariableNode(name[0]);
            }
        }
        
        if (std::isdigit(expr_[pos_]) || expr_[pos_] == '.') {
            size_t start = pos_;
            while (pos_ < expr_.size() && (std::isdigit(expr_[pos_]) || expr_[pos_] == '.')) pos_++;
            std::string num_str = expr_.substr(start, pos_ - start);
            return new NumberNode(std::stod(num_str));
        }
        
        return new NumberNode(0.0);
    }
};

extern "C" {
    __declspec(dllexport) C_FitResult* fit_curve(
        const double* x,
        const double* y,
        int data_size,
        const double* initial_params,
        int param_count,
        const char* func_expression) {
        
        C_FitResult* c_result = new C_FitResult();
        c_result->params = nullptr;
        c_result->param_count = 0;
        c_result->chi_squared = 0.0;
        c_result->iterations = 0;
        c_result->error_message = nullptr;
        c_result->success = 0;
        
        try {
            std::vector<double> x_vec(x, x + data_size);
            std::vector<double> y_vec(y, y + data_size);
            std::vector<double> init_params(initial_params, initial_params + param_count);
            
            std::string expr(func_expression);
            FuncExpressionParser parser(expr);
            FuncType func = parser.parse();
            
            LevenbergMarquardt lm;
            FitResult result = lm.fit(x_vec, y_vec, init_params, func);
            
            c_result->param_count = result.params.size();
            c_result->params = new double[result.params.size()];
            for (size_t i = 0; i < result.params.size(); ++i) {
                c_result->params[i] = result.params[i];
            }
            c_result->chi_squared = result.chi_squared;
            c_result->iterations = result.iterations;
            c_result->success = result.success ? 1 : 0;
            
            if (!result.error_message.empty()) {
                c_result->error_message = new char[result.error_message.length() + 1];
                std::strcpy(c_result->error_message, result.error_message.c_str());
            } else {
                c_result->error_message = new char[1];
                c_result->error_message[0] = '\0';
            }
        } catch (std::exception& e) {
            if (c_result->params) delete[] c_result->params;
            c_result->params = nullptr;
            c_result->success = 0;
            c_result->error_message = new char[std::strlen(e.what()) + 1];
            std::strcpy(c_result->error_message, e.what());
        }
        
        return c_result;
    }
    
    __declspec(dllexport) void free_fit_result(C_FitResult* result) {
        if (!result) return;
        if (result->params) delete[] result->params;
        if (result->error_message) delete[] result->error_message;
        delete result;
    }
}

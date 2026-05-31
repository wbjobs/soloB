import ctypes
import os
import platform
import threading
from typing import List, Optional, Dict, Any


class LibraryLoadError(Exception):
    pass


class FitResult:
    def __init__(self):
        self.params: List[float] = []
        self.chi_squared: float = 0.0
        self.iterations: int = 0
        self.error_message: str = ""
        self.success: bool = False


class LMWrapper:
    _instance: Optional['LMWrapper'] = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._lib: Optional[ctypes.CDLL] = None
        self._lib_loaded = False
        self._lib_path: Optional[str] = None
        self._load_error: Optional[str] = None
    
    def _get_possible_lib_paths(self) -> List[str]:
        system = platform.system()
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cpp_dir = os.path.join(base_dir, "cpp")
        libs_dir = os.path.join(base_dir, "libs")
        build_dir = os.path.join(cpp_dir, "build")
        release_dir = os.path.join(build_dir, "Release")
        
        possible_dirs = [
            release_dir,
            build_dir,
            cpp_dir,
            libs_dir,
        ]
        
        if system == "Windows":
            lib_names = [
                "levenberg_marquardt.dll",
                "fit.dll",
                "libfit.dll",
            ]
        elif system == "Linux":
            lib_names = [
                "liblevenberg_marquardt.so",
                "liblevenberg_marquardt.so.1",
                "libfit.so",
                "libfit.so.1",
            ]
        elif system == "Darwin":
            lib_names = [
                "liblevenberg_marquardt.dylib",
                "libfit.dylib",
            ]
        else:
            raise LibraryLoadError(f"Unsupported platform: {system}")
        
        paths = []
        for dir_path in possible_dirs:
            for lib_name in lib_names:
                full_path = os.path.join(dir_path, lib_name)
                paths.append(full_path)
        
        env_lib = os.environ.get('FIT_LIB_PATH')
        if env_lib:
            paths.insert(0, env_lib)
        
        return paths
    
    def _find_lib_path(self) -> str:
        possible_paths = self._get_possible_lib_paths()
        
        found_paths = []
        for path in possible_paths:
            if os.path.exists(path) and os.path.isfile(path):
                found_paths.append(path)
        
        if not found_paths:
            raise LibraryLoadError(
                f"Could not find Levenberg-Marquardt library. "
                f"Checked paths: {possible_paths}. "
                f"Please build the C++ library first or set FIT_LIB_PATH environment variable."
            )
        
        return found_paths[0]
    
    def _try_load_library(self, lib_path: str) -> Optional[ctypes.CDLL]:
        try:
            if platform.system() == "Windows":
                lib = ctypes.CDLL(lib_path, winmode=0)
            else:
                lib = ctypes.CDLL(lib_path)
            
            class C_FitResult(ctypes.Structure):
                _fields_ = [
                    ("params", ctypes.POINTER(ctypes.c_double)),
                    ("param_count", ctypes.c_int),
                    ("chi_squared", ctypes.c_double),
                    ("iterations", ctypes.c_int),
                    ("error_message", ctypes.c_char_p),
                    ("success", ctypes.c_int),
                ]
            
            if not hasattr(lib, 'fit_curve'):
                raise LibraryLoadError(
                    f"Symbol 'fit_curve' not found in library: {lib_path}"
                )
            if not hasattr(lib, 'free_fit_result'):
                raise LibraryLoadError(
                    f"Symbol 'free_fit_result' not found in library: {lib_path}"
                )
            
            lib.fit_curve.restype = ctypes.POINTER(C_FitResult)
            lib.fit_curve.argtypes = [
                ctypes.POINTER(ctypes.c_double),
                ctypes.POINTER(ctypes.c_double),
                ctypes.c_int,
                ctypes.POINTER(ctypes.c_double),
                ctypes.c_int,
                ctypes.c_char_p,
            ]
            
            lib.free_fit_result.restype = None
            lib.free_fit_result.argtypes = [ctypes.c_void_p]
            
            self._C_FitResult = C_FitResult
            
            return lib
            
        except OSError as e:
            raise LibraryLoadError(f"Failed to load library {lib_path}: {e}")
        except AttributeError as e:
            raise LibraryLoadError(f"Symbol error in library {lib_path}: {e}")
    
    def ensure_loaded(self):
        if self._lib_loaded and self._lib is not None:
            return
        
        with LMWrapper._lock:
            if self._lib_loaded and self._lib is not None:
                return
            
            if self._load_error is not None:
                raise LibraryLoadError(self._load_error)
            
            try:
                self._lib_path = self._find_lib_path()
                self._lib = self._try_load_library(self._lib_path)
                self._lib_loaded = True
                self._load_error = None
            except LibraryLoadError as e:
                self._load_error = str(e)
                raise
    
    def is_loaded(self) -> bool:
        return self._lib_loaded and self._lib is not None
    
    def _estimate_initial_params(self, x: List[float], y: List[float], func_expression: str) -> List[float]:
        expr_lower = func_expression.lower()
        params = []
        
        if 'a' in expr_lower:
            params.append(1.0)
        if 'b' in expr_lower:
            if 'exp' in expr_lower:
                params.append(0.1)
            else:
                params.append(1.0)
        if 'c' in expr_lower:
            params.append(min(y) if y else 0.0)
        if 'd' in expr_lower:
            params.append(0.0)
        if 'e' in expr_lower:
            params.append(0.0)
        
        return params
    
    def fit_curve(
        self,
        x: List[float],
        y: List[float],
        func_expression: str,
        initial_params: Optional[List[float]] = None
    ) -> FitResult:
        self.ensure_loaded()
        
        if self._lib is None:
            raise RuntimeError("Library not loaded")
        
        if len(x) != len(y):
            raise ValueError("x and y arrays must have the same length")
        
        if len(x) < 3:
            raise ValueError("At least 3 data points are required")
        
        if initial_params is None:
            initial_params = self._estimate_initial_params(x, y, func_expression)
        
        if not initial_params:
            raise ValueError("No initial parameters provided and could not estimate them")
        
        x_arr = (ctypes.c_double * len(x))(*x)
        y_arr = (ctypes.c_double * len(y))(*y)
        params_arr = (ctypes.c_double * len(initial_params))(*initial_params)
        
        func_expr_bytes = func_expression.encode('utf-8')
        
        result_ptr = self._lib.fit_curve(
            x_arr,
            y_arr,
            len(x),
            params_arr,
            len(initial_params),
            func_expr_bytes
        )
        
        if not result_ptr:
            raise RuntimeError("fit_curve returned null pointer")
        
        result = result_ptr.contents
        
        fit_result = FitResult()
        fit_result.success = bool(result.success)
        fit_result.chi_squared = result.chi_squared
        fit_result.iterations = result.iterations
        
        if result.params and result.param_count > 0:
            fit_result.params = [result.params[i] for i in range(result.param_count)]
        
        if result.error_message:
            try:
                fit_result.error_message = result.error_message.decode('utf-8', errors='ignore')
            except:
                fit_result.error_message = str(result.error_message)
        
        self._lib.free_fit_result(ctypes.cast(result_ptr, ctypes.c_void_p))
        
        return fit_result
    
    def evaluate_function(self, x: float, params: List[float], func_expression: str) -> float:
        import math
        
        variables = {'x': x}
        param_names = ['a', 'b', 'c', 'd', 'e']
        for i, val in enumerate(params):
            if i < len(param_names):
                variables[param_names[i]] = val
        
        safe_dict = {
            'exp': math.exp,
            'log': math.log,
            'sin': math.sin,
            'cos': math.cos,
            'tan': math.tan,
            'sqrt': math.sqrt,
            'pow': math.pow,
            'pi': math.pi,
            'e': math.e,
        }
        safe_dict.update(variables)
        
        try:
            return eval(func_expression, {"__builtins__": {}}, safe_dict)
        except Exception as e:
            raise ValueError(f"Error evaluating function: {e}")
    
    def get_fitted_curve(
        self,
        x_values: List[float],
        params: List[float],
        func_expression: str
    ) -> List[float]:
        return [self.evaluate_function(x, params, func_expression) for x in x_values]
    
    def get_lib_path(self) -> Optional[str]:
        return self._lib_path


_lm_wrapper_instance: Optional[LMWrapper] = None


def get_lm_wrapper() -> LMWrapper:
    global _lm_wrapper_instance
    if _lm_wrapper_instance is None:
        _lm_wrapper_instance = LMWrapper()
    return _lm_wrapper_instance


def fit_curve_wrapper(
    x: List[float],
    y: List[float],
    func_expression: str,
    initial_params: Optional[List[float]] = None
) -> Dict[str, Any]:
    wrapper = get_lm_wrapper()
    
    try:
        result = wrapper.fit_curve(x, y, func_expression, initial_params)
        
        return {
            "success": result.success,
            "params": result.params,
            "chi_squared": result.chi_squared,
            "iterations": result.iterations,
            "error_message": result.error_message,
        }
    except LibraryLoadError as e:
        return {
            "success": False,
            "params": [],
            "chi_squared": 0.0,
            "iterations": 0,
            "error_message": f"Library load error: {e}",
        }
    except Exception as e:
        return {
            "success": False,
            "params": [],
            "chi_squared": 0.0,
            "iterations": 0,
            "error_message": f"Fitting error: {e}",
        }


def is_library_available() -> bool:
    try:
        wrapper = get_lm_wrapper()
        wrapper.ensure_loaded()
        return True
    except:
        return False


def get_library_status() -> Dict[str, Any]:
    wrapper = get_lm_wrapper()
    return {
        "loaded": wrapper.is_loaded(),
        "path": wrapper.get_lib_path(),
        "error": wrapper._load_error if hasattr(wrapper, '_load_error') else None,
    }

#ifndef PHYSICS_ENGINE_H
#define PHYSICS_ENGINE_H

#include <SDL.h>
#include <vector>
#include <memory>
#include <algorithm>

namespace Physics {

struct Vector2 {
    float x;
    float y;

    Vector2() : x(0.0f), y(0.0f) {}
    Vector2(float x, float y) : x(x), y(y) {}

    Vector2 operator+(const Vector2& other) const {
        return Vector2(x + other.x, y + other.y);
    }

    Vector2& operator+=(const Vector2& other) {
        x += other.x;
        y += other.y;
        return *this;
    }

    Vector2 operator-(const Vector2& other) const {
        return Vector2(x - other.x, y - other.y);
    }

    Vector2& operator-=(const Vector2& other) {
        x -= other.x;
        y -= other.y;
        return *this;
    }

    Vector2 operator*(float scalar) const {
        return Vector2(x * scalar, y * scalar);
    }

    Vector2& operator*=(float scalar) {
        x *= scalar;
        y *= scalar;
        return *this;
    }

    Vector2 operator/(float scalar) const {
        return Vector2(x / scalar, y / scalar);
    }

    Vector2& operator/=(float scalar) {
        x /= scalar;
        y /= scalar;
        return *this;
    }

    float Dot(const Vector2& other) const {
        return x * other.x + y * other.y;
    }

    float LengthSquared() const {
        return x * x + y * y;
    }

    float Length() const {
        return sqrtf(LengthSquared());
    }

    Vector2 Normalize() const {
        float len = Length();
        if (len > 0.0f) {
            return Vector2(x / len, y / len);
        }
        return Vector2(0.0f, 0.0f);
    }
};

struct AABB {
    Vector2 min;
    Vector2 max;

    AABB() : min(Vector2()), max(Vector2()) {}
    AABB(const Vector2& min, const Vector2& max) : min(min), max(max) {}

    bool Intersects(const AABB& other) const {
        return (max.x >= other.min.x && min.x <= other.max.x) &&
               (max.y >= other.min.y && min.y <= other.max.y);
    }

    static AABB Merge(const AABB& a, const AABB& b) {
        return AABB(
            Vector2(std::min(a.min.x, b.min.x), std::min(a.min.y, b.min.y)),
            Vector2(std::max(a.max.x, b.max.x), std::max(a.max.y, b.max.y))
        );
    }

    Vector2 GetCenter() const {
        return (min + max) * 0.5f;
    }

    Vector2 GetExtents() const {
        return (max - min) * 0.5f;
    }
};

enum class ShapeType {
    BOX,
    CIRCLE
};

class RigidBody {
public:
    Vector2 position;
    Vector2 velocity;
    Vector2 acceleration;
    Vector2 force;

    float mass;
    float invMass;
    float restitution;
    float friction;
    bool isStatic;

    ShapeType shapeType;
    Vector2 size;
    float radius;
    SDL_Color color;

    RigidBody();

    void ApplyForce(const Vector2& f);
    void Update(float dt, const Vector2& gravity);
    AABB GetAABB() const;

    void Draw(SDL_Renderer* renderer) const;

    bool ContainsPoint(const Vector2& point) const;
    void SetStatic(bool s);
    void SetPosition(const Vector2& pos);

    Vector2 GetHalfExtents() const;
    AABB GetAABBAt(const Vector2& pos) const;
    AABB GetSweptAABB(const Vector2& displacement) const;
};

class CollisionDetector {
public:
    struct CollisionInfo {
        RigidBody* bodyA;
        RigidBody* bodyB;
        Vector2 normal;
        float penetration;
        bool hasCollision;
    };

    struct ContinuousCollisionInfo {
        RigidBody* bodyA;
        RigidBody* bodyB;
        Vector2 normal;
        float t;
        bool hasCollision;

        ContinuousCollisionInfo()
            : bodyA(nullptr)
            , bodyB(nullptr)
            , normal(Vector2(0, 0))
            , t(1.0f)
            , hasCollision(false)
        {}
    };

    static CollisionInfo CheckAABBvsAABB(RigidBody* a, RigidBody* b);
    static CollisionInfo CheckCollision(RigidBody* a, RigidBody* b);
    static void ResolveCollision(CollisionInfo& info);
    static void ApplyFriction(CollisionInfo& info);

    static ContinuousCollisionInfo CheckContinuousCollision(
        RigidBody* body,
        const Vector2& displacement,
        RigidBody* other
    );

    static bool RaycastAABB(
        const AABB& aabb,
        const Vector2& rayOrigin,
        const Vector2& rayDir,
        float& tMin,
        Vector2& normal
    );
};

class PhysicsWorld {
private:
    std::vector<std::unique_ptr<RigidBody>> bodies;
    Vector2 gravity;

public:
    PhysicsWorld(const Vector2& gravity = Vector2(0.0f, 9.8f));

    RigidBody* AddBox(float width, float height, float x, float y, float mass = 1.0f);
    RigidBody* AddCircle(float radius, float x, float y, float mass = 1.0f);
    void AddStaticBox(float width, float height, float x, float y);

    void Step(float dt);
    void Clear();

    RigidBody* GetBodyAtPoint(const Vector2& point);

    const std::vector<std::unique_ptr<RigidBody>>& GetBodies() const;
};

class PointMass {
public:
    Vector2 position;
    Vector2 oldPosition;
    Vector2 velocity;
    Vector2 acceleration;
    Vector2 force;

    float mass;
    float invMass;
    bool pinned;

    PointMass();
    PointMass(const Vector2& pos, float m = 1.0f, bool pin = false);

    void ApplyForce(const Vector2& f);
    void Update(float dt, const Vector2& gravity, float damping = 0.98f);
    void SetPinned(bool pin);
    void SetPosition(const Vector2& pos);
};

class Spring {
public:
    PointMass* massA;
    PointMass* massB;

    float restLength;
    float stiffness;
    float damping;

    Spring();
    Spring(PointMass* a, PointMass* b, float restLen, float stiff = 800.0f, float damp = 0.9f);

    void ApplyForce();
    float GetCurrentLength() const;
    Vector2 GetDirection() const;
};

class Cloth {
public:
    struct DragInfo {
        PointMass* mass;
        bool isDragging;
        Vector2 dragOffset;

        DragInfo() : mass(nullptr), isDragging(false), dragOffset(Vector2(0, 0)) {}
    };

private:
    std::vector<std::unique_ptr<PointMass>> points;
    std::vector<std::unique_ptr<Spring>> springs;

    int numCols;
    int numRows;
    float spacing;

    SDL_Color color;
    DragInfo dragInfo;

public:
    Cloth();
    ~Cloth();

    void Initialize(
        float startX, float startY,
        int cols, int rows,
        float spacingBetween,
        float pointMass = 0.5f,
        float stiffness = 800.0f,
        bool pinTopRow = true
    );

    void Update(float dt, const Vector2& gravity);
    void Draw(SDL_Renderer* renderer) const;

    PointMass* GetPointAt(const Vector2& pos, float radius = 10.0f);
    bool TryStartDrag(const Vector2& mousePos);
    void UpdateDrag(const Vector2& mousePos);
    void EndDrag();

    int GetNumPoints() const { return static_cast<int>(points.size()); }
    int GetNumSprings() const { return static_cast<int>(springs.size()); }
    const SDL_Color& GetColor() const { return color; }
    void SetColor(const SDL_Color& c) { color = c; }
};

class Game {
private:
    SDL_Window* window;
    SDL_Renderer* renderer;
    bool isRunning;

    std::unique_ptr<PhysicsWorld> world;

    bool isDragging;
    RigidBody* draggedBody;
    Vector2 dragOffset;
    Vector2 lastMousePos;

    std::vector<std::unique_ptr<Cloth>> cloths;
    Cloth::DragInfo clothDragInfo;

    void HandleEvents();
    void Render();
    void SpawnRandomBody(const Vector2& pos);
    void SpawnCloth(const Vector2& pos);

public:
    Game();
    ~Game();

    bool Initialize(const char* title, int width, int height);
    void Run();
    void Cleanup();
};

}

#endif
